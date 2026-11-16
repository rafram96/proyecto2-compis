"""Genera el mismo diseño como PDF y PowerPoint editable, con notas."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'build/presentation-deps'))
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from PIL import Image

HERE = Path(__file__).resolve().parent
DATA = json.loads((HERE / 'contenido.json').read_text(encoding='utf-8'))
W, H, S = 1280, 720, .75
INK, CYAN, MUTED, PALE, ORANGE = '#202020', '#00B4F0', '#56656F', '#EFF8FC', '#E99447'
FONT_DIR = Path('C:/Windows/Fonts')
for name, file in [('Arial', 'arial.ttf'), ('Arial-Bold', 'arialbd.ttf'), ('Mono', 'consola.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / file)))

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W/96), Inches(H/96)
prs.core_properties.title = DATA['title']
prs.core_properties.author = '; '.join(DATA['authors'])
prs.core_properties.subject = 'Proyecto CS3025 Compiladores · CaPybara · UTEC'
pdf = canvas.Canvas(str(HERE/'CaPybara.pdf'), pagesize=(W*S,H*S))
pdf.setTitle(DATA['title'])
pdf.setAuthor('; '.join(DATA['authors']))
current = None

def box(x,y,w,h,color, radius=False):
    shape=current.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
                                   Inches(x/96), Inches(y/96), Inches(w/96), Inches(h/96))
    shape.fill.solid();shape.fill.fore_color.rgb=RGBColor.from_string(color[1:]);shape.line.fill.background()
    if radius:
        shape.adjustments[0]=.08
    pdf.setFillColor(HexColor(color));pdf.setStrokeColor(HexColor(color))
    if radius: pdf.roundRect(x*S,(H-y-h)*S,w*S,h*S,10*S,stroke=0,fill=1)
    else: pdf.rect(x*S,(H-y-h)*S,w*S,h*S,stroke=0,fill=1)
    return shape

def text(value,x,y,w,size=24,color=INK,bold=False,h=None,mono=False,align='left'):
    font='Mono' if mono else 'Arial-Bold' if bold else 'Arial'
    lines=[]
    for original in value.split('\n'):
        if mono:
            assert pdfmetrics.stringWidth(original,font,size*S)<=w*S+1, ('code overflow', original)
            lines.append(original);continue
        words=original.split(' ');line=''
        for word in words:
            test=(line+' '+word).strip()
            if line and pdfmetrics.stringWidth(test,font,size*S)>w*S:
                lines.append(line);line=word
            else:line=test
        lines.append(line)
    line_height=size*1.23
    height=h if h is not None else len(lines)*line_height+3
    assert len(lines)*line_height<=height+3,('textbox overflow',value,len(lines)*line_height,height)
    assert y+height<=H+1, ('out of canvas',value,y,height)
    tb=current.shapes.add_textbox(Inches(x/96),Inches(y/96),Inches(w/96),Inches(height/96))
    tf=tb.text_frame;tf.word_wrap=False
    tf.margin_left=tf.margin_right=tf.margin_top=tf.margin_bottom=0
    from pptx.enum.text import PP_ALIGN
    for i,line in enumerate(lines):
        p=tf.paragraphs[0] if i==0 else tf.add_paragraph()
        p.text=line;p.font.name='Consolas' if mono else 'Arial';p.font.size=Pt(size*S)
        p.font.bold=bold;p.font.color.rgb=RGBColor.from_string(color[1:])
        p.space_before=Pt(0);p.space_after=Pt(0);p.line_spacing=Pt(line_height*S)
        p.alignment={'left':PP_ALIGN.LEFT,'center':PP_ALIGN.CENTER,'right':PP_ALIGN.RIGHT}[align]
        pdf.setFont(font,size*S);pdf.setFillColor(HexColor(color))
        baseline=(H-y-size*.94-i*line_height)*S
        if align=='center':pdf.drawCentredString((x+w/2)*S,baseline,line)
        elif align=='right':pdf.drawRightString((x+w)*S,baseline,line)
        else:pdf.drawString(x*S,baseline,line)
    return tb

def image(file,x,y,w,h):
    iw,ih=Image.open(file).size
    ratio=min(w/iw,h/ih);ww,hh=iw*ratio,ih*ratio
    xx,yy=x+(w-ww)/2,y+(h-hh)/2
    current.shapes.add_picture(str(file),Inches(xx/96),Inches(yy/96),width=Inches(ww/96),height=Inches(hh/96))
    pdf.drawImage(str(file),xx*S,(H-yy-hh)*S,ww*S,hh*S,mask='auto')

def slide(i,chapter,dark=False):
    global current
    current=prs.slides.add_slide(prs.slide_layouts[6])
    color='#111B22' if dark else '#FFFFFF'
    current.background.fill.solid();current.background.fill.fore_color.rgb=RGBColor.from_string(color[1:])
    pdf.setFillColor(HexColor(color));pdf.rect(0,0,W*S,H*S,fill=1,stroke=0)
    text(f'{i:02d} / {chapter.upper()}',64,40,1000,16,CYAN,True)
    text('CaPybara',1050,40,166,18,'#FFFFFF' if dark else INK,True,align='right')
    box(64,676,1152,1,'#33444E' if dark else '#D9E6ED')
    text('UTEC · CS3025 Compiladores',64,689,700,13,'#AFC1CC' if dark else MUTED)
    text(f'{i} / 7',1100,689,116,13,'#AFC1CC' if dark else MUTED,align='right')
    current.notes_slide.notes_text_frame.text=DATA['slides'][i-1]['notes']+'\n\nTransición: '+DATA['slides'][i-1]['transition']+'\n\nFuentes y alcance: '+DATA['slides'][i-1]['data']

def end():pdf.showPage()
def title(t):text(t,64,89,1152,45,INK,True)
def table(x,y,w,headers,rows):
    rowh=35
    box(x,y,w,rowh,INK,radius=True)
    for j,label in enumerate(headers):text(label,x+18+j*w/2,y+7,w/2-30,18,'#FFFFFF',True)
    for i,row in enumerate(rows):
        yy=y+(i+1)*rowh
        box(x,yy,w,rowh,PALE if i%2==0 else '#F8FBFD')
        for j,label in enumerate(row):text(str(label),x+18+j*w/2,yy+6,w/2-30,19)

logo=ROOT/'docs/img/capybara.png'

slide(1,'El problema',True)
text('Solo necesitábamos\nun resumen de ventas.',64,100,1120,58,'#FFFFFF',True)
text('¿Cuánto vendió cada cliente? La pregunta es simple. El camino puede no serlo.',64,265,1100,24,'#D4E1E9')
for x,mins,label in [(64,'8 min','Revisar la sintaxis'),(344,'7 min','Corregir columnas'),(624,'5 min','Resolver los nulos')]:
    box(x,350,256,155,'#20313C',True)
    text(mins,x+24,369,210,46,CYAN,True)
    text(label,x+24,436,210,22,'#FFFFFF')
text('20',947,342,230,103,CYAN,True)
text('minutos',953,466,250,28,'#FFFFFF')
box(64,550,1152,80,'#20313C',True)
text('ESCENARIO ILUSTRATIVO',85,567,330,16,CYAN,True)
text('No medimos tiempo de desarrollo. Esta historia plantea la pregunta que queremos investigar.',430,564,750,21,'#E4EEF4')
end()

slide(2,'La idea')
text('¿Y si bastara con expresar\nla transformación?',64,99,800,50,INK,True)
text('CaPybara',64,295,720,73,INK,True)
text('Un lenguaje específico para transformar tablas.',68,394,730,28,MUTED)
image(logo,910,170,280,265)
for x,word,desc in [(64,'Intención','Qué leer, limpiar y agrupar'),(459,'CaPybara','Verifica columnas y tipos'),(854,'Polars','Ejecuta el plan generado')]:
    box(x,501,362,109,PALE,True)
    text(word,x+22,518,320,28,INK,True)
    text(desc,x+22,564,320,19,MUTED)
text('→',432,532,22,25,CYAN,True);text('→',827,532,22,25,CYAN,True)
text('Escribir la intención. Ejecutar con Polars.',64,630,1152,24,INK,True)
end()

slide(3,'Un ejemplo')
title('Leer, limpiar, agrupar y guardar')
box(64,184,736,435,'#111B22',True)
code=(HERE/'ventas.etl').read_text(encoding='utf-8').rstrip()
text(code,86,204,693,22,'#E7F5FE',mono=True)
text('ENTRADA · ventas.csv',850,192,360,17,CYAN,True)
table(850,225,366,['cliente','monto'],[['Ana','120'],['Ana','NULL'],['Luis','80'],['Ana','30']])
text('↓',1015,415,50,36,CYAN,True,align='center')
text('SALIDA · resumen.parquet',850,467,366,17,CYAN,True)
table(850,501,366,['cliente','total'],[['Ana','150'],['Luis','80']])
text('El ? permite nulos. Las instrucciones terminan en ;. El resultado fue verificado con el runtime.',64,636,1152,19,MUTED)
end()

slide(4,'Cómo funciona')
title('El compilador entiende tus tablas')
for x,word,desc in [(64,'01 · Analizar','Lee la sintaxis'),(360,'02 · Verificar','Comprueba columnas y tipos'),(656,'03 · Optimizar','Transforma el plan'),(952,'04 · Generar','Python + Polars')]:
    box(x,195,264,105,PALE,True)
    text(word,x+18,212,230,25,INK,True)
    text(desc,x+18,255,232,18,MUTED)
    if x<952:text('→',x+271,230,22,24,CYAN,True)
box(64,336,1152,74,INK,True)
text('WHERE mnto > 0;',85,356,346,25,'#FFFFFF',mono=True)
text('→',433,355,40,27,CYAN,True)
text('E_COLUMN: columna inexistente',492,355,690,25,'#FFFFFF',mono=True)
text('13/16',64,452,460,72,CYAN,True)
text('errores detectados al compilar',64,548,510,25,INK,True)
text('Corpus propio: 2 más al ejecutar; 1 no detectado.',64,591,520,20,MUTED)
text('−22 %',700,452,490,72,CYAN,True)
text('tokens léxicos frente a Polars',700,548,516,25,INK,True)
text('508 vs. 652 en cinco tareas. Más líneas: 78 vs. 61.',700,591,516,20,MUTED)
text('Con esquema declarado, el error de columna se detecta sin leer el archivo. Fuente: reporte, evaluación de errores y expresividad.',64,646,1152,15,MUTED)
end()

slide(5,'La evidencia')
title('La promesa, frente al cronómetro')
text('Tiempo de CaPybara / tiempo de Polars · mediana en SF 30',64,158,1152,24,MUTED)
start,unit=330,109
box(start+unit,238,1,341,'#A4B9C6')
text('1 = Polars',start+unit-45,214,150,16,MUTED)
names=['Resumen de precios','Ingreso por descuento','Ingreso por pedido','Limpieza de pedidos','Devoluciones']
ratios=[1.00,1.07,1.02,4.35,1.07]
for i,(name,r) in enumerate(zip(names,ratios)):
    yy=259+i*64
    text(name,64,yy-1,250,20,INK,i==3)
    box(start,yy,r*unit,26,ORANGE if i==3 else CYAN,True)
    text(f'{r:.2f}'.replace('.',','),start+r*unit+13,yy-2,85,21,INK,True)
for n in range(6):text(str(n),start+n*unit-8,593,40,16,MUTED)
box(946,235,270,317,PALE,True)
text('4 de 5',966,258,230,59,INK,True)
text('tareas con 0–7 %\nde sobrecosto',966,346,226,27,INK,True)
text('Limpieza cuesta 4,35×:\npreservar el orden\nañade trabajo.',966,446,226,21,'#92511E')
text('Más de 1 = más tiempo. Cinco tareas derivadas de TPC-H; 180 millones de filas en lineitem (SF 30).',64,635,1152,17,MUTED)
text('10 repeticiones tras calentamiento. Excluye inicio de Python y compilación; compilación medida aparte: mediana de 42 ms.',64,658,1152,14,MUTED)
end()

slide(6,'Usabilidad para LLMs')
title('Un punto y coma también cambia la historia')
text('60 tareas compatibles · una respuesta por tarea y lenguaje · sin corregir el código',64,158,1152,23,MUTED)
for left,title_,values in [(64,'Guía inicial',[42,48]),(656,'Guía reforzada de CaPybara',[50,41])]:
    box(left,221,560,337,'#F6FAFC',True)
    text(title_,left+24,239,510,25,INK,True)
    bottom,scale=500,3.2
    box(left+34,bottom,490,1,'#CCDCE5')
    for dx,name_,v,color in [(96,'CaPybara',values[0],CYAN),(326,'Polars',values[1],'#667D8C')]:
        x=left+dx;hh=v*scale
        box(x,bottom-hh,130,hh,color,True)
        text(f'{v}/60',x-20,bottom-hh-43,170,31,INK,True,align='center')
        text(name_,x-20,bottom+13,170,21,INK,True,align='center')
box(64,584,1152,44,PALE,True)
text('Errores por omitir ; en CaPybara: 12 → 0',84,592,1112,26,INK,True,align='center')
text('Exploratorio: guía ajustada en el mismo corpus. Polars varió con el mismo prompt. Junie Lite / Qwen3.6-27B-FP8.',64,645,1152,16,MUTED)
end()

slide(7,'Lo que sigue')
title('Lo que falta también importa')
cards=[('01','Rendimiento','Quitar orden innecesario.\nEvitar recalcular nodos\ncon varias salidas.'),('02','Cobertura','Funciones de fecha,\nventanas y UNION.\nJOIN usa la forma de grafo.'),('03','Evidencia','Medir tiempo y comprensión\ncon personas. Replicar con\nmás LLMs y otro corpus.')]
for x,(num,head,body) in zip([64,460,856],cards):
    box(x,193,360,257,PALE,True)
    text(num,x+24,213,304,27,CYAN,True)
    text(head,x+24,263,310,30,INK,True)
    text(body,x+24,325,310,22,MUTED)
box(64,491,1152,116,INK,True)
box(81,504,100,88,'#FFFFFF',True)
image(logo,88,511,86,74)
text('Menos fricción al escribir.\nPolars al ejecutar.',215,507,956,36,'#FFFFFF',True)
text('github.com/rafram96/proyecto2-compis',64,627,1152,21,CYAN,True)
text('Rafael Ramos Huamani · Gabriel Vargas Urmeneta · David Silva Mena · Angel Tribeño Hurtado',64,657,1152,17,INK)
end()

pdf.save()
prs.save(str(HERE/'CaPybara.pptx'))
assert len(prs.slides)==7
print('Generados CaPybara.pdf y CaPybara.pptx: siete diapositivas con notas y logo original.')
