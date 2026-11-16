"""Genera tabla, figura y cifras de usabilidad para LLMs desde corridas guardadas."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'reporte/generado_v2'
RUNS = [ROOT/'bench-LLM/resultados'/name for name in (
    'junie-20261115-final', 'junie-20261115-polars', 'junie-20261115-polars-punto-coma')]


def main():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    data = [json.loads((path/'evaluacion.json').read_text(encoding='utf-8')) for path in RUNS]
    labels = ['Python puro', 'Polars, guía inicial', 'Polars, guía reforzada']
    rows, audit = [], []
    for i,(path,d) in enumerate(zip(RUNS,data)):
        assert d['paired_samples'] and len(d['results']) == 120
        assert len(d['manifest']['selected']) == 60
        baseline = 'python' if i==0 else 'polars'
        cap, other = d['summary']['capybara'], d['summary'][baseline]
        assert cap['samples']==other['samples']==60
        semis = sum(any(x['code']=='E_SYNTAX' and 'se esperaba: ";", "="' in x['message']
                        for x in r.get('diagnostics',[])) for r in d['results'] if r['language']=='capybara')
        rows.append(f"{labels[i]} & {cap['correct_samples']}/60 & {other['correct_samples']}/60 & {semis}"+r" \\")
        audit.append({'run':path.name, 'sha256':hashlib.sha256((path/'evaluacion.json').read_bytes()).hexdigest(),
                      'capybara_correct':cap['correct_samples'], 'baseline_correct':other['correct_samples'],
                      'missing_semicolons':semis})
    (OUT/'tablas').mkdir(parents=True,exist_ok=True)
    (OUT/'figuras').mkdir(parents=True,exist_ok=True)
    table='\n'.join([r'\begin{tabular}{@{}lrrr@{}}',r'\toprule',
                     r'Comparación & Capybara & Python & Sin \texttt{;} \\',r'\midrule',
                     *rows,r'\bottomrule',r'\end{tabular}'])+'\n'
    (OUT/'tablas/usabilidad_llm.tex').write_text(table,encoding='utf-8')
    c = {'llmCapInicial':data[1]['summary']['capybara']['correct_samples'],
         'llmPolInicial':data[1]['summary']['polars']['correct_samples'],
         'llmCapFinal':data[2]['summary']['capybara']['correct_samples'],
         'llmPolFinal':data[2]['summary']['polars']['correct_samples'],
         'llmCapPct':f"{data[2]['summary']['capybara']['accuracy_on_submitted_samples']*100:.1f}".replace('.',','),
         'llmPolPct':f"{data[2]['summary']['polars']['accuracy_on_submitted_samples']*100:.1f}".replace('.',','),
         'llmPuntoAntes':audit[1]['missing_semicolons'], 'llmPuntoDespues':audit[2]['missing_semicolons']}
    (OUT/'cifras_llm.tex').write_text(''.join(rf'\newcommand{{\{k}}}{{{v}}}'+'\n' for k,v in c.items()),encoding='utf-8')
    (OUT/'procedencia_llm.json').write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':8,'pdf.fonttype':42,
                         'axes.spines.top':False,'axes.spines.right':False,'axes.axisbelow':True})
    fig,ax=plt.subplots(figsize=(3.32,1.6))
    for j,(key,name,color,dy) in enumerate([('capybara','Capybara','#1765a5',-.16),('polars','Python con Polars','#cf7134',.16)]):
        vals=[d['summary'][key]['correct_samples']/60*100 for d in data[1:]]
        ax.barh([dy,1+dy],vals,height=.28,label=name,color=color)
        for y,value in zip([dy,1+dy],vals):
            ax.text(value+1.5,y,f'{value:.1f} %',va='center',fontsize=7)
    ax.set_yticks([0,1],['Guía inicial','Guía reforzada'])
    ax.invert_yaxis()
    ax.set_xlim(0,100)
    ax.set_xticks([0,25,50,75,100])
    ax.set_xlabel('Tareas correctas (%)')
    ax.grid(axis='x',color='#e4e9ee')
    fig.legend(*ax.get_legend_handles_labels(),loc='upper center',ncol=2,frameon=False,fontsize=7)
    fig.subplots_adjust(left=.3,right=.98,top=.77,bottom=.3)
    for suffix in ['pdf','png']:
        fig.savefig(OUT/'figuras'/f'usabilidad_llm.{suffix}',bbox_inches='tight',dpi=200)
    plt.close(fig)
    print('Generados: tabla, figura, macros y procedencia de tres corridas LLM.')


if __name__=='__main__':
    main()
