"""Regenera la evaluación de main_v2 desde bench/resultados, sin modificar main.

Ejecutar desde la raíz: python reporte/graficos_v2.py
Requiere las dependencias de análisis de bench/analisis.py.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bench"))
import analisis as a
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.colors import TwoSlopeNorm
import numpy as np
import pandas as pd

a.NOMBRE["dsl"] = "Capybara"
OUT = ROOT / "reporte" / "generado_v2"
COLOR = {"dsl": "#1765a5", "polars": "#cf7134", "duckdb": "#228071", "pandas": "#92529b"}
LABELS = ["Resumen de\nprecios", "Ingreso por\ndescuento", "Ingreso por\npedido", "Limpieza de\npedidos", "Devoluciones"]


def estilo():
    a.estilo()
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 8,
        "axes.labelsize": 8, "axes.titlesize": 8.5,
        "xtick.labelsize": 7.5, "ytick.labelsize": 7.5,
        "legend.fontsize": 7.5, "axes.axisbelow": True,
        "axes.edgecolor": "#c4ccd3", "grid.color": "#e4e9ee",
        "grid.alpha": 0.8, "lines.linewidth": 1.6,
        "savefig.pad_inches": 0.07,
    })


def guardar(fig, nombre):
    fig.savefig(OUT / "figuras" / f"{nombre}.pdf")
    fig.savefig(OUT / "figuras" / f"{nombre}.png", dpi=200)
    plt.close(fig)


def leyenda_sistemas(fig, systems=a.SISTEMAS):
    handles = [Line2D([], [], color=COLOR[s], marker=a.MARCADOR[s], label=a.NOMBRE[s],
                      markersize=4) for s in systems]
    columnas = len(systems) if fig.get_figwidth() > 5 or len(systems) < 4 else 2
    fig.legend(handles=handles, loc="upper center", ncol=columnas, frameon=False,
               bbox_to_anchor=(0.5, 1.01))


def escalabilidad(r, df):
    escalas = sorted(r.index.get_level_values("sf").unique())
    fallos = {(f.sf, f.tarea, f.configuracion) for f in a.fallas(df).itertuples()}
    fig, axes = plt.subplots(1, 5, figsize=(7.0, 2.55), sharex=True)
    for i, (ax, tarea) in enumerate(zip(axes, a.TAREAS)):
        for s in a.SISTEMAS:
            puntos = [(sf, r.loc[(sf, tarea, s)]) for sf in escalas if (sf, tarea, s) in r.index]
            x = [p[0] for p in puntos]
            y = np.array([p[1].mediana for p in puntos])
            q1, q3 = [np.array([getattr(p[1], q) for p in puntos]) for q in ("q1", "q3")]
            ax.fill_between(x, q1, q3, color=COLOR[s], alpha=.12)
            ax.errorbar(x, y, yerr=[y-q1, q3-y], color=COLOR[s], marker=a.MARCADOR[s],
                        markersize=3, capsize=2, elinewidth=.7)
            for sf in escalas:
                if (sf, tarea, s) in fallos:
                    ax.plot(sf, .94, "x", transform=ax.get_xaxis_transform(), color=COLOR[s], ms=5)
        ax.set_yscale("log")
        ax.set_xticks(escalas, [str(int(s)) for s in escalas])
        ax.minorticks_off()
        ax.set_title(f"({chr(97+i)}) {LABELS[i]}", loc="left", pad=9)
        ax.set_xlabel("Escala (SF)")
        ax.grid(axis="x", visible=False)
    axes[0].set_ylabel("Tiempo (s, escala log.)")
    leyenda_sistemas(fig)
    fig.subplots_adjust(top=.73, bottom=.21, left=.075, right=.99, wspace=.48)
    guardar(fig, "escalabilidad")


def tabla_rendimiento(r, df):
    """Medianas, RIC y razones de medianas a partir de las mediciones."""
    escalas = sorted(r.index.get_level_values("sf").unique())
    fallos = {(f.sf, f.tarea, f.configuracion) for f in a.fallas(df).itertuples()}
    filas, razones = [], {}
    for tarea in a.TAREAS:
        for i, sf in enumerate(escalas):
            celdas = [a.NOMBRE_TAREA[tarea] if i == 0 else "", a.sf_txt(sf)]
            for sistema in a.SISTEMAS:
                if (sf, tarea, sistema) in r.index:
                    valor = r.loc[(sf, tarea, sistema)]
                    celdas.append(f"{a.seg(valor.mediana)} {{\\scriptsize[{a.seg(valor.q1)}, {a.seg(valor.q3)}]}}")
                else:
                    celdas.append("sin mem." if (sf, tarea, sistema) in fallos else "--")
            razon = r.loc[(sf, tarea, "dsl")].mediana / r.loc[(sf, tarea, "polars")].mediana
            razones[sf, tarea] = float(razon)
            celdas.append(f"{razon:.2f}")
            filas.append(" & ".join(celdas) + r" \\")
        if tarea != a.TAREAS[-1]:
            filas.append(r"\midrule")
    return "\n".join([
        r"\begin{tabular}{@{}llrrrrr@{}}", r"\toprule",
        r"Tarea & SF & Capybara & Polars & DuckDB & Pandas & Capybara/Polars \\",
        r"\midrule", *filas, r"\bottomrule", r"\end{tabular}",
    ]), razones


def relativo(razones):
    escalas = sorted({sf for sf, _ in razones})
    valores = np.array([[razones[sf,t] for sf in escalas] for t in a.TAREAS])
    fig, ax = plt.subplots(figsize=(3.32, 2.5))
    # El color codifica log2(razón), centrado exactamente en la paridad.
    extent = max(abs(np.log2(valores)).max(), .1)
    ax.imshow(np.log2(valores), cmap="BrBG_r", norm=TwoSlopeNorm(vmin=-extent, vcenter=0, vmax=extent), aspect="auto")
    for i in range(len(a.TAREAS)):
        for j, sf in enumerate(escalas):
            value = razones[sf,a.TAREAS[i]]
            ax.text(j, i, f"{value:.2f}×", ha="center", va="center",
                    fontsize=8, color="white" if abs(np.log2(value)) > extent*.65 else "#14232d")
    ax.set_yticks(range(5), LABELS)
    ax.set_xticks(range(len(escalas)), [str(int(sf)) for sf in escalas])
    ax.set_xlabel("Factor de escala · 1× = paridad con Polars")
    ax.tick_params(length=0)
    ax.grid(False)
    for spine in ax.spines.values():
        spine.set_visible(False)
    fig.tight_layout(pad=.3)
    guardar(fig, "relativo")


def panorama(r, razones, sf):
    fig, ax = plt.subplots(figsize=(3.32, 2.75))
    ax.axvline(1, color=COLOR["polars"], lw=1, ls="--")
    for i,t in enumerate(a.TAREAS):
        ax.axhspan(i-.44, i+.44, color="#f2f5f8", zorder=0)
        for s,dy in [("dsl",-.23),("duckdb",0),("pandas",.23)]:
            if (sf,t,s) not in r.index:
                ax.text(20, i+dy, "sin memoria", color=COLOR[s], ha="right", va="center", fontsize=6)
                continue
            value = r.loc[(sf,t,s)].mediana / r.loc[(sf,t,"polars")].mediana
            if s == "dsl":
                value = razones[sf,t]
                ax.annotate(f"{value:.2f}×", (value,i+dy), xytext=(5,0), textcoords="offset points", fontsize=6.5, va="center", color=COLOR[s])
            ax.plot(value, i+dy, marker=a.MARCADOR[s], color=COLOR[s], ms=4)
    ax.set_xscale("log")
    ax.set_xlim(.42,26)
    ax.set_xticks([.5,1,2,5,10,20], ["0.5×","1×","2×","5×","10×","20×"])
    ax.minorticks_off()
    ax.set_yticks(range(5), LABELS)
    ax.set_ylim(4.6,-.6)
    ax.set_xlabel(f"Tiempo / Polars · SF {sf:g}")
    ax.grid(axis="y", visible=False)
    ax.tick_params(axis="y", length=0)
    leyenda_sistemas(fig, ["dsl","duckdb","pandas"])
    fig.subplots_adjust(left=.29, right=.98, top=.85, bottom=.17)
    guardar(fig, "panorama")


def memoria(r, df, sf):
    fig, ax = plt.subplots(figsize=(3.32, 2.6))
    fallos = {(f.sf,f.tarea,f.configuracion) for f in a.fallas(df).itertuples()}
    for k,s in enumerate(a.SISTEMAS):
        for i,t in enumerate(a.TAREAS):
            y = i + (k-1.5)*.18
            if (sf,t,s) in r.index:
                value = r.loc[(sf,t,s)].memoria_mb / 1024
                ax.barh(y, value, height=.16, color=COLOR[s])
            elif (sf,t,s) in fallos:
                ax.plot(31,y,marker=">",color=COLOR[s],ms=4)
                ax.text(30,y-.02,">31",va="center",ha="right",fontsize=6,color=COLOR[s])
    ax.set_yticks(range(5), LABELS)
    ax.set_ylim(4.6,-.6)
    ax.set_xlim(0,33)
    ax.set_xticks([0,10,20,30])
    ax.set_xlabel(f"Memoria pico (GB) · SF {sf:g}")
    ax.grid(axis="y", visible=False)
    ax.tick_params(axis="y",length=0)
    leyenda_sistemas(fig)
    fig.subplots_adjust(left=.29,right=.98,top=.85,bottom=.18)
    guardar(fig,"memoria")


def optimizaciones(r, sf):
    pares = [("Sin optimizaciones de Capybara (O0)", "dsl-O0", "dsl", COLOR["dsl"], "o"),
             ("Sin optimizaciones de Capybara (O0);\nPolars sin optimizador", "dsl-O0-sin-opt-polars", "dsl-sin-opt-polars", "#637f9a", "D"),
             ("Sin optimizador de Polars", "dsl-sin-opt-polars", "dsl", COLOR["polars"], "s")]
    fig, ax = plt.subplots(figsize=(3.32,3.15))
    for k,(label,num,den,col,mark) in enumerate(pares):
        values = [r.loc[(sf,t,num)].mediana/r.loc[(sf,t,den)].mediana for t in a.TAREAS]
        y = np.arange(5)+(k-1)*.22
        ax.plot(values,y,linestyle="none",marker=mark,color=col,label=label,ms=4)
        if k == 2:
            for x,yi in zip(values,y):
                ax.annotate(f"{x:.1f}×",(x,yi),xytext=(5,0),textcoords="offset points",fontsize=6.5,va="center",color=col)
    ax.axvline(1,ls="--",color="#687784",lw=1)
    ax.set_xscale("log")
    ax.set_xlim(.75,7)
    ax.set_xticks([1,2,3,5],["1×","2×","3×","5×"])
    ax.minorticks_off()
    ax.set_yticks(range(5),LABELS)
    ax.set_ylim(4.5,-.5)
    ax.grid(axis="y",visible=False)
    ax.set_xlabel(f"Tiempo sin / con optimización · SF {sf:g}")
    fig.legend(*ax.get_legend_handles_labels(),loc="upper center",frameon=False,ncol=1,bbox_to_anchor=(.54,1.01),fontsize=7)
    fig.subplots_adjust(left=.29,right=.98,top=.69,bottom=.16)
    guardar(fig,"optimizaciones")


def errores(er):
    categorias = [("compilación","Al compilar",COLOR["dsl"],None),
                  ("ejecución","Al ejecutar","#90b9d8",None),
                  ("silencioso","Sin detectar","#e4d8c5","///")]
    fig,ax = plt.subplots(figsize=(3.32,1.45))
    for i,serie in enumerate([er.dsl_momento.replace("no detectado","silencioso"),er.polars_momento]):
        start=0
        for value,label,color,hatch in categorias:
            n=int((serie==value).sum())
            if n:
                ax.barh(i,n,left=start,height=.5,color=color,edgecolor="white",hatch=hatch,label=label if i==0 else None)
                ax.text(start+n/2,i,str(n),ha="center",va="center",fontweight="bold",fontsize=8,color="white" if value=="compilación" else "#203344")
                start+=n
    ax.set_yticks([0,1],["Capybara","Polars"])
    ax.set_ylim(1.5,-.5)
    ax.set_xlim(0,len(er))
    ax.set_xticks([0,4,8,12,16])
    ax.grid(axis="y",visible=False)
    ax.set_xlabel(f"Número de errores · corpus de {len(er)} casos")
    fig.legend(*ax.get_legend_handles_labels(),loc="upper center",ncol=3,frameon=False,bbox_to_anchor=(.5,1.02),fontsize=7,handlelength=1.1,columnspacing=.9)
    fig.subplots_adjust(left=.23,right=.98,top=.76,bottom=.33)
    guardar(fig,"errores")


def expresividad(ex):
    totals=ex.groupby("version")[["tokens","lineas"]].sum()
    fig,axes=plt.subplots(1,2,figsize=(3.32,1.8))
    for ax,metric,label in zip(axes,["tokens","lineas"],["Tokens totales","Líneas totales"]):
        values=[int(totals.loc[s,metric]) for s in a.SISTEMAS]
        ax.barh(range(4),values,color=[COLOR[s] for s in a.SISTEMAS],height=.58)
        for i,value in enumerate(values):
            ax.text(value+max(values)*.03,i,str(value),va="center",fontsize=7)
        ax.set_yticks(range(4),[a.NOMBRE[s] for s in a.SISTEMAS])
        ax.invert_yaxis()
        ax.set_xlim(0,max(values)*1.3)
        ax.set_xlabel(label)
        ax.grid(axis="y",visible=False)
    fig.tight_layout(pad=.3,w_pad=1)
    guardar(fig,"expresividad")


def main():
    corridas=sorted(p.parent for p in a.RESULTADOS.glob("*/tiempos.csv"))
    df,todas=a.cargar_tiempos(corridas)
    r=a.resumen(df)
    ex=pd.read_csv(a.RESULTADOS/"expresividad.csv")
    er=pd.read_csv(a.RESULTADOS/"errores.csv").fillna("")
    sf=max(r.index.get_level_values("sf"))
    rendimiento,razones=tabla_rendimiento(r,df)
    optimizaciones_tex=a.tabla_optimizaciones(r,sf).replace("Tarea & O0 &", "Tarea & Sin opt. (O0) &").replace("& DSL O0 &", "& Sin opt. (O0) &")
    for nombre,tabla in {"rendimiento":rendimiento,"optimizaciones":optimizaciones_tex,
                         "memoria":a.tabla_memoria(r,df,sf),"expresividad":a.tabla_expresividad(ex),
                         "errores":a.tabla_errores(er)}.items():
        a.escribir(OUT/"tablas"/f"{nombre}.tex",tabla)
    # El generador compartido de macros espera una secuencia por razón.
    razones_macros = {clave: (valor,) for clave, valor in razones.items()}
    a.escribir(OUT/"cifras.tex",a.macros(a.cifras(r,df,todas,razones_macros,ex,er,sf)))
    a.escribir(OUT/"procedencia.txt", "Fuente: bench/resultados; selección idéntica a bench/analisis.py.\n"+
               "\n".join(f"SF {escala:g}: {corrida}" for escala,corrida in df.groupby("sf").corrida.first().items())+
               f"\nMediciones correctas: {int((df.estado=='ok').sum())}\nResumen: mediana y rango intercuartílico; razones de medianas.\n")
    (OUT/"figuras").mkdir(parents=True,exist_ok=True)
    estilo()
    escalabilidad(r,df)
    relativo(razones)
    panorama(r,razones,sf)
    memoria(r,df,sf)
    optimizaciones(r,sf)
    errores(er)
    expresividad(ex)
    print("Listo: siete gráficos PDF vectoriales y vistas PNG en", OUT)


if __name__=="__main__":
    main()
