import {
  formatCurrency,
  formatMultiplier,
  formatNumber,
  formatPercent,
  formatPeriod,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PrintReportData } from "@/lib/reports/print-data";

/* =====================================================================
   O corpo do painel público
   ---------------------------------------------------------------------
   Componente de SERVIDOR, sem estado. Tudo o que ele desenha vem de
   `getPrintReportData` — a mesma função da folha A4 e do PDF enviado.

   A ORDEM É A DE QUEM LÊ, não a do banco: primeiro o resumo (quanto
   entrou, quanto voltou), depois a evolução no tempo, depois campanha a
   campanha, e por último os anúncios. Quem só quer saber "como foi o
   mês" para na primeira faixa; quem quer entender POR QUE desce.
   ===================================================================== */

export function PainelPublico({ dados }: { dados: PrintReportData }) {
  const { kpis, platformDetail, creatives, weekly, period } = dados;

  return (
    <div className="mt-8 flex flex-col gap-8">
      <p className="text-xs text-muted-foreground">
        {formatPeriod(period.start, period.end)}
      </p>

      {/* --- Resumo -------------------------------------------------- */}
      <section>
        <h2 className="eyebrow">Resumo do período</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((kpi) => (
            <div key={kpi.key} className="surface-card p-4">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                {kpi.label}
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums">
                {kpi.formatted}
              </p>

              {/* Comparação com o período anterior de mesmo tamanho.
                  Quando não há base, a frase diz isso — em vez de um
                  "0%" que o cliente leria como estabilidade. */}
              <p
                className={cn(
                  "mt-1 text-2xs",
                  kpi.deltaPercent === null
                    ? "text-muted-foreground"
                    : kpi.sentiment === "positive"
                      ? "text-positive"
                      : kpi.sentiment === "negative"
                        ? "text-negative"
                        : "text-muted-foreground",
                )}
              >
                {kpi.deltaPercent === null
                  ? "sem base de comparação"
                  : `${kpi.deltaPercent > 0 ? "+" : ""}${kpi.deltaPercent
                      .toFixed(1)
                      .replace(".", ",")}% vs. período anterior`}
              </p>

              {/* De onde o número saiu, quando houve recorte. Sem isto o
                  custo não fecha com o investimento ao lado e quem
                  confere na calculadora conclui que a tela está errada. */}
              {kpi.origem !== null && (
                <p className="mt-1 text-2xs text-muted-foreground">
                  de {kpi.origem}{" "}
                  {kpi.origem === 1 ? "campanha" : "campanhas"} de origem
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* --- Evolução ------------------------------------------------ */}
      {weekly.length > 0 && (
        <section>
          <h2 className="eyebrow">Evolução no período</h2>
          <BarrasSemanais semanas={weekly} />
        </section>
      )}

      {/* --- Campanhas ----------------------------------------------- */}
      {platformDetail.map((p) => (
        <section key={p.platform}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="eyebrow">Campanhas · {p.label}</h2>
            <span className="text-2xs text-muted-foreground">
              {formatPercent(p.spendShare)} do investimento
            </span>
          </div>

          {/* ⚠️ A TABELA ROLA SOZINHA. São sete colunas e o cliente abre
              no celular — sem o contêiner com rolagem própria, a página
              inteira ganharia barra horizontal e o resto do conteúdo
              sairia do lugar. */}
          <div className="surface-card mt-3 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-hairline text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Campanha</th>
                  <th className="px-3 py-2.5 text-right font-medium">Investido</th>
                  <th className="px-3 py-2.5 text-right font-medium">Result.</th>
                  <th className="px-3 py-2.5 text-right font-medium">Custo</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cliques</th>
                  <th className="px-3 py-2.5 text-right font-medium">CTR</th>
                  <th className="px-4 py-2.5 text-right font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {p.campaigns.map((c) => (
                  <tr key={`${p.platform}-${c.name}`}>
                    <td className="max-w-[18rem] truncate px-4 py-2.5" title={c.name}>
                      {c.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatCurrency(c.spendCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(c.results)}
                    </td>
                    {/* "—" e não "R$ 0,00": campanha sem resultado tem
                        custo por resultado INDEFINIDO, não zero. */}
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {c.results > 0 ? formatCurrency(c.cpaCents) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatNumber(c.clicks)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatPercent(c.ctr, 2)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {c.roas > 0 ? formatMultiplier(c.roas) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* --- Anúncios ------------------------------------------------ */}
      {creatives.length > 0 && (
        <section>
          <h2 className="eyebrow">Anúncios que rodaram</h2>

          {!dados.criativosDoPeriodo && (
            <p className="mt-2 rounded-lg bg-warning-muted px-3 py-2 text-2xs text-warning">
              Não foi possível apurar os anúncios nesta janela — os números
              abaixo são da última sincronização, não do período escolhido.
            </p>
          )}

          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {creatives.map((ad) => (
              <li key={ad.id} className="surface-card flex gap-3 p-3">
                {ad.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ad.thumbnail_url}
                    alt=""
                    className="size-16 shrink-0 rounded-lg object-cover"
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {ad.headline ?? ad.ad_name ?? "—"}
                  </p>
                  <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-2xs">
                    <div>
                      <dt className="inline text-muted-foreground">Investido </dt>
                      <dd className="inline font-medium tabular-nums">
                        {formatCurrency(ad.spend_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">Result. </dt>
                      <dd className="inline font-medium tabular-nums">
                        {formatNumber(ad.conversions)}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline text-muted-foreground">CTR </dt>
                      <dd className="inline font-medium tabular-nums">
                        {formatPercent(
                          ad.impressions > 0 ? ad.clicks / ad.impressions : 0,
                          2,
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Barras por semana, desenhadas com div.
 *
 * Sem biblioteca de gráfico: são poucas barras, o dado é uma série
 * simples, e trazer Recharts para cá custaria mais JavaScript no
 * carregamento do que a página inteira — numa tela que o cliente abre
 * pelo celular, muitas vezes em rede ruim.
 */
function BarrasSemanais({
  semanas,
}: {
  semanas: { label: string; spend: number; results: number }[];
}) {
  const teto = Math.max(...semanas.map((s) => s.spend), 1);

  return (
    <div className="surface-card mt-3 p-4">
      <div className="flex items-end gap-2" style={{ height: 140 }}>
        {semanas.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="text-2xs tabular-nums text-muted-foreground">
              {formatCurrency(Math.round(s.spend * 100))}
            </span>
            <div
              className="w-full rounded-t bg-signal"
              /* `Math.max(…, 2)` para a semana quase zerada continuar
                 visível: barra de 0px lê como semana ausente, e ausente
                 é outra coisa. */
              style={{ height: Math.max((s.spend / teto) * 100, 2) }}
            />
            <span className="w-full truncate text-center text-2xs text-muted-foreground">
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
