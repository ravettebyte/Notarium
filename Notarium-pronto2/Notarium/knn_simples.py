"""Exemplo didático com dados fictícios. O KNN usa apenas Python nativo.

Deixe estagiarios.csv na mesma pasta. Instale apenas matplotlib:
    python -m pip install matplotlib
Execute:
    python knn_simples.py
"""

import csv
import math
from pathlib import Path
import matplotlib.pyplot as plt


def ler_estagiarios(nome_arquivo):
    estagiarios = []
    with open(nome_arquivo, encoding="utf-8", newline="") as arquivo:
        leitor = csv.DictReader(arquivo)
        for linha in leitor:
            estagiario = {
                "frequencia": float(linha["frequencia"]),
                "desenrolo": float(linha["desenrolo"]),
                "contratado": linha["contratado"],
            }
            estagiarios.append(estagiario)
    return estagiarios


def distancia_euclidiana(estagiario1, estagiario2):
    diferenca_frequencia = estagiario1["frequencia"] - estagiario2["frequencia"]
    diferenca_desenrolo = estagiario1["desenrolo"] - estagiario2["desenrolo"]
    distancia = math.sqrt(diferenca_frequencia ** 2 + diferenca_desenrolo ** 2)
    return distancia



def knn(estagiarios, novo_estagiario, k=3):

    if k < 1 or k > len(estagiarios):
        raise ValueError("K deve estar entre 1 e a quantidade de estagiários.")

    distancias = []
    for estagiario in estagiarios:
        distancia = distancia_euclidiana(estagiario, novo_estagiario)
        distancias.append((distancia, estagiario))


    # item[0] é a distância. Ordenamos do menor para o maior.
    distancias.sort(key=lambda item: item[0])

   

    vizinhos = distancias[:k]




    votos_sim = 0
    votos_nao = 0


    for distancia, estagiario in vizinhos:
        if estagiario["contratado"] == "sim":
            votos_sim += 1
        else:
            votos_nao += 1

    if votos_sim > votos_nao:
        previsao = "sim"
    else:
        previsao = "nao"  # Regra deste exemplo para eventual empate.
    return previsao, vizinhos


def mostrar_grafico(estagiarios, novo_estagiario, vizinhos, ampliar=False):
    fig, ax = plt.subplots(figsize=(8, 6), layout="constrained")
    cores = {"sim": "#178273", "nao": "#D66A54"}

    for estagiario in estagiarios:
        ax.scatter(estagiario["frequencia"], estagiario["desenrolo"],
                   color=cores[estagiario["contratado"]], s=90,
                   edgecolor="white", linewidth=0.8, zorder=3)

    for indice, (distancia, estagiario) in enumerate(vizinhos, start=1):
        ax.plot([novo_estagiario["frequencia"], estagiario["frequencia"]],
                [novo_estagiario["desenrolo"], estagiario["desenrolo"]],
                color="#81929E", linestyle="--", linewidth=1.3, zorder=2)
        ax.scatter(estagiario["frequencia"], estagiario["desenrolo"],
                   s=230, facecolors="none", edgecolors="#21374C",
                   linewidth=1.5, zorder=4)
        if ampliar:
            ax.annotate(f"{indice}º: {distancia:.2f}",
                        (estagiario["frequencia"], estagiario["desenrolo"]),
                        xytext=(12, 12), textcoords="offset points",
                        fontsize=11, color="#21374C")

    ax.scatter(novo_estagiario["frequencia"], novo_estagiario["desenrolo"],
               marker="*", s=380, color="#F2BE45", edgecolor="#21374C",
               linewidth=1.2, zorder=5, label="Novo estagiário")
    ax.scatter([], [], color=cores["sim"], s=90, label="Contratado: sim")
    ax.scatter([], [], color=cores["nao"], s=90, label="Contratado: não")

    if ampliar:
        frequencias = [novo_estagiario["frequencia"]] + [e["frequencia"] for d, e in vizinhos]
        desenrolos = [novo_estagiario["desenrolo"]] + [e["desenrolo"] for d, e in vizinhos]
        ax.set_xlim(max(0, min(frequencias) - 5), min(100, max(frequencias) + 6))
        ax.set_ylim(max(0, min(desenrolos) - 5), min(100, max(desenrolos) + 6))
    else:
        ax.set_xlim(0, 100)
        ax.set_ylim(0, 100)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("Frequência (%)", fontsize=13)
    ax.set_ylabel("Desenrolo (%)", fontsize=13)
    ax.set_title("KNN: novo estagiário e seus vizinhos", fontsize=16, pad=15)
    ax.legend(loc="upper left", fontsize=10, framealpha=0.95)
    ax.grid(color="#E3E9EE", linewidth=0.7, zorder=0)
    ax.spines[["top", "right"]].set_visible(False)
    return fig


if __name__ == "__main__":
    pasta = Path(__file__).parent
    estagiarios = ler_estagiarios(pasta / "estagiarios.csv")

    # ALTERE ESTES DOIS VALORES PARA TESTAR OUTRO ESTAGIÁRIO.
    novo_estagiario = {"frequencia": 85, "desenrolo": 75}
    k = 3

    previsao, vizinhos = knn(estagiarios, novo_estagiario, k)
    print("Previsão de contratação:", previsao)
    print("Vizinhos mais próximos:")
    for distancia, estagiario in vizinhos:
        print(estagiario, "Distância:", round(distancia, 2))

    fig = mostrar_grafico(estagiarios, novo_estagiario, vizinhos)
    fig.savefig(pasta / "comparacao_estagiarios.png", dpi=200)
    fig_zoom = mostrar_grafico(estagiarios, novo_estagiario, vizinhos, ampliar=True)
    fig_zoom.savefig(pasta / "vizinhos_estagiarios.png", dpi=200)
    plt.show()
