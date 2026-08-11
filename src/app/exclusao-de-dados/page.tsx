import type { Metadata } from "next";

import { LegalPage } from "@/components/layout/legal-page";

export const metadata: Metadata = {
  title: "Exclusão de dados",
  description:
    "Como pedir a remoção dos dados tratados pelo Send Hub e revogar o acesso às contas de anúncio.",
};

/**
 * A Meta exige uma URL de instruções de exclusão para liberar o Login
 * do Facebook. Ela precisa dizer COMO pedir e em quanto tempo — uma
 * página genérica de "fale conosco" costuma ser reprovada na revisão.
 */
export default function ExclusaoDeDadosPage() {
  return (
    <LegalPage titulo="Exclusão de dados" atualizadoEm="11 de agosto de 2026">
      <p>
        Esta página explica como remover os dados tratados pelo Send Hub, o
        sistema interno da Agência Send. Há dois caminhos, e eles são
        independentes.
      </p>

      <h2>1. Revogar o acesso do app, você mesmo</h2>
      <p>
        Isso corta imediatamente a leitura dos dados da sua conta de anúncio,
        sem depender de ninguém:
      </p>
      <ul>
        <li>
          <strong>Facebook:</strong> Configurações e privacidade → Configurações
          → Apps e sites → selecione <strong>send-hub</strong> → Remover.
        </li>
        <li>
          <strong>Google:</strong> acesse a página de permissões da sua Conta
          Google, encontre o Send Hub e remova o acesso.
        </li>
      </ul>
      <p>
        A partir daí o token guardado deixa de funcionar e nenhuma sincronização
        nova acontece.
      </p>

      <h2>2. Pedir a exclusão dos dados já armazenados</h2>
      <p>
        Escreva para{" "}
        <a href="mailto:trafegosend@gmail.com" className="text-signal underline">
          trafegosend@gmail.com
        </a>{" "}
        com o assunto <strong>&ldquo;Exclusão de dados&rdquo;</strong>, dizendo:
      </p>
      <ul>
        <li>o nome da empresa ou da conta de anúncio;</li>
        <li>o e-mail ou o ID da conta usada para autorizar.</li>
      </ul>
      <p>
        Confirmamos o recebimento em até <strong>2 dias úteis</strong> e
        concluímos a remoção em até <strong>30 dias corridos</strong>.
      </p>

      <h2>O que é apagado</h2>
      <ul>
        <li>o token de acesso da conta de anúncio;</li>
        <li>o histórico diário de investimento, resultados e receita importado da plataforma;</li>
        <li>as miniaturas e os nomes dos anúncios;</li>
        <li>os relatórios em PDF gerados para aquela conta;</li>
        <li>os dados cadastrais do cliente e as anotações de público.</li>
      </ul>

      <h2>O que pode permanecer, e por quê</h2>
      <p>
        Registros exigidos por obrigação fiscal ou contábil — notas e
        lançamentos financeiros do contrato — são mantidos pelo prazo que a lei
        determina, mesmo depois do pedido. Eles não contêm dados vindos das
        plataformas de anúncio.
      </p>
      <p>
        Os dados que estão <em>dentro</em> do Facebook ou do Google não são
        apagados por nós: eles pertencem à sua conta naquelas plataformas e
        continuam lá. O Send Hub só remove a cópia que importou.
      </p>
    </LegalPage>
  );
}
