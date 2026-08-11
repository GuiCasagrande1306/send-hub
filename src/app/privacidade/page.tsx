import type { Metadata } from "next";

import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como o Send Hub, sistema interno da Agência Send, trata os dados que processa.",
};

/**
 * Escrita a partir do que o sistema REALMENTE faz, não de modelo pronto.
 * Cada afirmação aqui corresponde a uma tabela, uma coluna ou uma
 * chamada de API que existe no código — se o comportamento mudar, este
 * texto precisa mudar junto.
 */
export default function PrivacidadePage() {
  return (
    <LegalPage titulo="Política de Privacidade" atualizadoEm="11 de agosto de 2026">
      <p>
        O Send Hub é um sistema <strong>interno</strong> da Agência Send, usado
        pela própria equipe para acompanhar campanhas de mídia paga das contas
        que a agência administra. Ele não é um produto aberto ao público: não há
        cadastro livre, e o acesso depende de liberação por um administrador da
        agência.
      </p>

      <h2>Quem usa e o que guardamos de quem usa</h2>
      <p>
        Cada pessoa da equipe tem uma conta com <strong>nome, e-mail e cargo</strong>.
        A autenticação é feita pelo Supabase; a senha é guardada por ele, em
        formato irreversível, e o Send Hub nunca tem acesso a ela.
      </p>

      <h2>Dados das contas de anúncio</h2>
      <p>
        Quando um administrador conecta uma conta do Meta Ads ou do Google Ads,
        o sistema passa a ler, uma vez por dia:
      </p>
      <ul>
        <li>investimento, impressões, cliques, conversões e receita, por dia e por campanha;</li>
        <li>nome e miniatura dos anúncios em veiculação;</li>
        <li>saldo e limite de orçamento da conta, quando a plataforma expõe.</li>
      </ul>
      <p>
        São <strong>dados agregados de desempenho</strong>. O sistema não lê, não
        pede e não armazena informação pessoal de quem viu ou clicou nos
        anúncios: nada de listas de público, dados de contato de leads ou
        identificadores de usuários finais.
      </p>
      <p>
        A permissão pedida ao Facebook é <strong>somente de leitura</strong>
        (<code>ads_read</code>). O Send Hub não cria, não pausa e não edita
        campanha nenhuma.
      </p>

      <h2>Tokens de acesso</h2>
      <p>
        O token devolvido pela plataforma no momento da autorização fica numa
        tabela separada, com acesso bloqueado no banco de dados: nenhuma sessão
        de usuário o alcança, nem a de um administrador. Só o servidor lê, e só
        para chamar a API da plataforma. Ele expira sozinho e pode ser revogado
        a qualquer momento pelo dono da conta, nas configurações do Facebook ou
        do Google.
      </p>

      <h2>Dados dos clientes da agência</h2>
      <p>
        Guardamos os dados cadastrais necessários para operar o contrato: razão
        social, pessoa de contato, e-mail, número de WhatsApp para envio de
        relatório e anotações sobre o público-alvo. Os relatórios em PDF gerados
        ficam armazenados em área privada.
      </p>

      <h2>WhatsApp</h2>
      <p>
        Os relatórios são enviados por WhatsApp a partir do número da própria
        pessoa da equipe, que autoriza a conexão lendo um QR Code. O sistema
        envia mensagens; ele não lê nem arquiva conversas.
      </p>

      <h2>Com quem os dados são compartilhados</h2>
      <p>
        Com ninguém, para fim nenhum de marketing ou venda. Os dados transitam
        apenas pelos serviços que fazem o sistema funcionar — Supabase
        (banco e autenticação), Vercel (hospedagem) e a infraestrutura de envio
        de WhatsApp da própria agência —, e pelas APIs do Meta e do Google, que
        são a origem dos números.
      </p>

      <h2>Por quanto tempo</h2>
      <p>
        Enquanto o contrato com o cliente estiver ativo e pelo tempo necessário
        ao histórico de resultados. Encerrado o contrato, os dados podem ser
        apagados a pedido — ver a página de{" "}
        <a href="/exclusao-de-dados" className="text-signal underline">
          exclusão de dados
        </a>
        .
      </p>

      <h2>Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção ou exclusão dos seus dados, e revogar a
        conexão de uma conta de anúncio a qualquer momento. Basta escrever para{" "}
        <a href="mailto:trafegosend@gmail.com" className="text-signal underline">
          trafegosend@gmail.com
        </a>
        .
      </p>
    </LegalPage>
  );
}
