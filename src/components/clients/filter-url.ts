/* =====================================================================
   URL dos filtros da carteira
   ---------------------------------------------------------------------
   Sobrou um único filtro que vive na URL — o mês —, mas o construtor
   continua existindo por um motivo: ele é quem decide que o mês
   CORRENTE não aparece na querystring. Sem isso, `/clientes` e
   `/clientes?month=2026-08` seriam duas URLs para a mesma tela, com dois
   caches e dois históricos de navegação.

   Havia aqui também o filtro de agência, removido quando ficou claro
   que a Send não terceiriza: com uma agência só, o seletor pedia uma
   escolha que nunca mudava o resultado. Se um dia entrar terceirização,
   o parâmetro volta a este mesmo lugar, e o ponto de sempre receber o
   estado completo continua valendo — cada seletor montando a própria
   querystring apagaria o do vizinho.
   ===================================================================== */

export function buildClientsUrl({
  month,
  currentMonth,
}: {
  month: string;
  /** Mês corrente: omitido da URL para o link limpo ser o padrão. */
  currentMonth: string;
}): string {
  const params = new URLSearchParams();

  if (month && month !== currentMonth) params.set("month", month);

  const qs = params.toString();
  return qs ? `/clientes?${qs}` : "/clientes";
}
