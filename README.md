# Notarium

Plataforma musical em português, com a interface original, API em Netlify Functions, PostgreSQL gerenciado, arquivos privados em Blobs e contas em Netlify Identity. Este repositório contém código; dados privados e backups pertencem aos serviços de armazenamento.

## Instalação e desenvolvimento

Use Node.js 22 e o repositório privado https://github.com/ravettebyte/Notarium.

```sh
npm ci
npm start
```

Abra http://localhost:8889. O comando inicia Netlify Dev com o frontend Vite e emulação das funções. É necessário estar vinculado ao projeto Netlify autorizado. Conexões de Database, Identity e Blobs são fornecidas pelo ambiente; não cole credenciais no código. Consulte `.env.example` para a única preferência opcional de retenção.

O ambiente fornecido nesta alteração ainda não tinha as migrações aplicadas. Antes do primeiro deploy, a API pode responder 503 porque as tabelas ainda não existem. Não execute SQL de criação manualmente contra a produção. As migrações em `netlify/database/migrations` são aplicadas pelo processo de publicação.

## Publicação

O projeto já está associado ao GitHub. O processo Netlify executa `npm run build`, publica somente `dist` e empacota as funções separadamente. A lista de arquivos públicos é explícita: banco antigo, backups, servidores antigos, dependências, documentação e configurações privadas não são copiados. As instruções antigas de publicar toda a raiz foram substituídas.

O primeiro acesso cria a primeira conta de professor/administrador na API, com confirmação de senha. Uma transação PostgreSQL serializa a verificação e impede duas contas iniciais. Depois disso, professores cadastram alunos; somente o administrador cadastra outros professores. Os papéis são consultados no banco, nunca aceitos do navegador. O endpoint público de cadastro do Identity é negado pelo evento `userValidate`. As contas controladas usam a API administrativa do Identity e começam confirmadas pelo serviço; isso **não comprova a propriedade do e-mail**. Valide essa propriedade antes de matricular estudantes, sobretudo menores. A recuperação de senha confirma o acesso à caixa postal.

Na publicação de produção, confira a ativação do Identity, o domínio e o remetente dos e-mails. Teste recuperação real, cookies HTTPS, evento de bloqueio de cadastro público e a primeira conta em um ambiente de homologação. Não crie contas de teste com dados de alunos. A ativação foi preparada no projeto; o envio de e-mail e as sessões reais não foram validados neste ambiente.

## Recursos conectados

Aulas e blocos, exercícios e avaliações, atribuição à turma ou a alunos selecionados, respostas, correção automática no servidor, notas manuais parciais, comentários, notificações, presença visível aos professores, perfis privados e materiais enviados usam persistência no servidor. O aluno recebe apenas seus registros e os conteúdos autorizados. As respostas corretas não seguem nos enunciados; referências auditivas são geradas como WAV privado pelo servidor.

O piano usa Web Audio, incluindo volume e acordes. O editor de partitura em Configurações salva uma composição por usuário, aceita notas, acidentes e pausas, mostra MusicXML e reproduz a sequência no andamento escolhido. Nesta versão ele usa semínimas e compasso 4/4; não é um editor completo de notação. As ferramentas anteriores de harmonia, avaliação e leitura MusicXML foram preservadas.

Arquivos têm limite de **3 MB**, adequado ao transporte das Functions com JSON/base64. PDF, PNG, JPEG, WebP, MP3, WAV, OGG, MP4, WebM, MusicXML e MXL têm validação de extensão, MIME e assinatura básica. Isso não substitui antivírus. Vídeos maiores devem ser disponibilizados por links permitidos; o limite não é anunciado como 15 MB. Arquivos são imutáveis no Blobs e os registros apontam para a versão atual. A remoção lógica exige desvinculação; objetos antigos podem continuar no armazenamento para preservar backups. Não há coleta automática desses objetos nesta versão.

O navegador conserva apenas preferências de som e os mecanismos de sessão da biblioteca Identity; não é banco principal. Os dados antigos do navegador não são apagados nem importados automaticamente para outra conta. Importações aceitam dados JSON/JSON5 sem executar JavaScript.

## Banco e evolução

`db/schema.ts` define tabelas de usuários, conteúdos, respostas, materiais, trilhas, notificações, avaliações, composições, limites de acesso e operações de backup. Campos específicos dos conteúdos são JSONB, com IDs e referências importantes em colunas relacionais. Aulas, respostas e perfis não são arquivos locais. As relações e os campos de entrada são validados no servidor.

Para alterar a estrutura:

```sh
npm run db:generate -- --name add_descricao_da_mudanca
```

Inclua a nova migração no histórico. Não altere migrações já aplicadas. Atualize também `server/restore-schema.sql`, usado exclusivamente pelo teste isolado de restauração, concatenando as migrações na ordem. Não execute esse arquivo diretamente na produção. As atualizações de conteúdo usam revisão para detectar edições antigas em outra aba; respostas e correções já recebidas não são substituídas pelo modelo enviado pelo professor.

A API atual carrega o conteúdo da escola por requisição e usa um bloqueio transacional global. Isso prioriza consistência para uma escola pequena; exige paginação, consultas específicas e bloqueios menores antes de operar com grandes volumes. Todos os professores autorizados administram o mesmo espaço. Turmas independentes com professores isolados e vínculos de matrícula próprios ainda não foram implementadas.

## Validação

```sh
npm run check
npm test
npx playwright install chromium
# Em outro terminal, mantenha npm start ativo:
npm run test:browser
```

Os testes de API usam um PostgreSQL descartável (PGlite), com o schema SQL real e as operações reais do repositório. Identity e Blobs são adaptadores substituídos por implementações de teste; isso não valida a disponibilidade nem as configurações desses serviços em produção. Os testes de navegador usam a interface real e respostas controladas da API. Consulte [os resultados e limites dos testes](docs/validation.md).

## Backups e recuperação

Leia [o procedimento operacional](docs/recovery.md). Há um agendador diário às **03h UTC** que despacha um trabalho autenticado por autorização de uso único, com execução em função background. O teste semanal de restauração é despachado aos domingos às **04h UTC**. As rotinas não dependem de visitas ao site e só são agendadas no deploy publicado de produção.

Backups incluem tabelas da aplicação, metadados, arquivos e checksums em outro armazenamento Blobs. Não incluem hashes de senha nem credenciais internas do Identity. Assim, não constituem recuperação independente completa do provedor de autenticação. Uma perda do serviço Identity exige recriação segura de identidades e remapeamento de IDs; esse procedimento assistido continua pendente de implementação automatizada.

## Segurança e operação

A biblioteca Identity gerencia senhas e tokens. A aplicação não guarda senhas nem hashes próprios. Cookies são Secure/SameSite da biblioteca; não se promete HttpOnly porque a biblioteca também suporta fluxos no navegador. Há validação de origem nas mutações, limites persistentes de login por IP e por conta, consultas parametrizadas, arquivos privados, sanitização de texto e uma política CSP. Nenhum botão do navegador concede função administrativa.

Atualize dependências em homologação, execute os testes e revise `npm audit` antes de publicar. Mantenha o repositório privado. Não envie `.env`, dados antigos de usuários, arquivos de alunos ou ZIPs privados ao GitHub. Os arquivos locais antigos foram preservados no checkout e excluídos da nova publicação; se já estiverem no histórico, `.gitignore` não remove versões passadas. O proprietário deve revisar esse histórico e o acesso ao repositório.

O professor pode excluir alunos; os dados relacionais vinculados são removidos e as credenciais são revogadas no Identity. Não há exclusão autônoma do administrador nem uma política legal de retenção/consentimento implementada. A API disponibiliza exportação autenticada dos próprios dados em `/api/account/export`. Defina consentimento, retenção e atendimento aos responsáveis antes de usar dados de menores.

## GitHub e versões

As alterações desta execução ficaram no workspace para o fluxo de versionamento/publicação da plataforma. Nenhum commit, push ou tag foi executado por esta alteração e nenhum novo endereço de publicação foi confirmado. Depois de revisar o conjunto, o mantenedor pode organizar commits por banco/API, interface e recuperação; proteger `main`; executar testes em uma branch; e marcar uma versão após homologar. Não inclua dados privados nos commits.

## Serviços, custos e pendências

São usados Netlify Database, Blobs, Functions, agendamento e Identity do projeto existente. Não foi contratado um serviço externo pago. Consumo de banco, armazenamento, transferências, e-mails e execução está sujeito ao plano e às cotas Netlify; o administrador precisa conferir a precificação antes de aumentar o uso. Não foi configurada uma cópia independente da conta/provedor Netlify.

Ainda dependem de publicação/homologação: migrações, provisionamento, e-mails reais, sessões e permissões com Identity real, agendamento de produção, redeploy sem perda e recuperação a partir dos serviços remotos. Também ficam pendentes: turmas independentes, verificação obrigatória da propriedade do e-mail no cadastro inicial, mural/perfis compartilhados por consentimento, editor completo de notação, backup exportável das credenciais Identity, restauração automática em outro provedor e alertas externos por e-mail de falhas. O alerta implementado aparece nas notificações dos professores e no monitor de backups.
