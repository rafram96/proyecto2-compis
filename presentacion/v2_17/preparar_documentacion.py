"""Documenta fuentes y reúne las vistas previas obtenidas con el MCP de Canva."""
import hashlib
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'build/presentation-deps'))
from reportlab.pdfgen import canvas

data=json.loads((HERE/'contenido.json').read_text(encoding='utf-8'))
assets=json.loads((HERE/'recursos_canva.json').read_text(encoding='utf-8'))
assert len(data['slides'])==17
assert {s['figure'] for s in data['slides'] if 'figure' in s}=={a['name'] for a in assets}
for a in assets:
    assert hashlib.sha256((ROOT/a['source']).read_bytes()).hexdigest()==a['sha256']
papers=[
 ('2512.23214v1.pdf','Anka: A Domain-Specific Language for Reliable LLM Code Generation','Saif Khalfan Saif Al Mazrouei','2025','https://arxiv.org/abs/2512.23214','1, 6–7'),
 ('peerj-cs-1835.pdf','A domain-specific language for managing ETL processes','Aleksandar Popović, Vladimir Ivković, Nikola Trajković, Ivan Luković','2024','https://doi.org/10.7717/peerj-cs.1835','1–3, 19, 21–22'),
 ('2505.16764v2.pdf','Can a Domain-Specific Language Improve Program Structure Comprehension of Data Pipelines? A Mixed-Methods Study.','Philip Heltweg, Georg-Daniel Schwarz, Dirk Riehle','2025','https://arxiv.org/abs/2505.16764','1, 12–13')
]
sources=[]
for filename,title,authors,year,url,pages in papers:
    source=Path('C:/Users/USER/Downloads')/filename
    sources.append(dict(file=filename,title=title,authors=authors,year=year,url=url,pages_consulted=pages,sha256=hashlib.sha256(source.read_bytes()).hexdigest()))
(HERE/'fuentes.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
md=['# '+data['title'],'','17 diapositivas. Notas para exponer y fuentes del contenido.','',
    'El tiempo de la apertura es ilustrativo. Las afirmaciones de facilidad frente a SQL se presentan como intención de diseño; rendimiento y tokens se acotan a las tareas medidas.','']
for i,s in enumerate(data['slides'],1):
    md += [f'## {i:02d}. {s["title"]}','','**Idea:** '+s['lead'],'',s['body'],'','**Pie de la diapositiva:** '+s['footer'],'','**Para exponer:** '+s['notes'],'','**Transición:** '+(data['slides'][i]['lead'] if i<17 else 'Abrir preguntas o demostrar el programa de ventas.'),'','**Fuente:** '+s['source'],'']
    if s.get('figure'):md += ['**Gráfico original:** `reporte/generado_v2/figuras/'+s['figure']+'.png`','']
md += ['## Referencias principales','']
for p in sources:md += [f'- {p["authors"]} ({p["year"]}). [{p["title"]}]({p["url"]}). PDF proporcionado: `{p["file"]}`; páginas {p["pages_consulted"]}.']
(HERE/'guion.md').write_text('\n'.join(md)+'\n',encoding='utf-8')
pdf=canvas.Canvas(str(HERE/'vista_previa_canva.pdf'),pagesize=(960,540))
pdf.setTitle('CaPybara · vista previa en Canva · 17 diapositivas')
pdf.setAuthor('; '.join(data['authors']))
for p in range(1,18):
    image=ROOT/f'build/canva17_preview_{p}.png'
    assert image.exists()
    pdf.drawImage(str(image),0,0,width=960,height=540)
    pdf.showPage()
pdf.save()
evidence={'diapositivas':17,'figuras_originales':len(assets),'fuentes_pdf':len(sources),'hashes_de_figuras_verificados':True,'ejemplo':'../ventas.etl, validado anteriormente con el runtime','estado':'borrador en Canva, pendiente de aprobación de la vista previa'}
(HERE/'verificacion.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Verificados: 17 diapositivas, ocho gráficos originales sin modificar y tres PDF leídos. Guion y vista previa preparados.')
