# Notarium

Plataforma de aprendizagem musical com aulas, blocos de exercícios, avaliações e prática interativa de ritmo no piano. O modo local funciona sem conta; o modo compartilhado exige a API Node do Notarium.

## Iniciar o Notarium

1. Instale as dependências locais do projeto uma vez:

   ```powershell
   npm.cmd install
   ```

2. Inicie o servidor local:

   ```powershell
   npm.cmd start
   ```

3. Abra `http://127.0.0.1:4173` no navegador. Encerre com `Ctrl+C`.

Também é possível abrir `index.html` com a extensão **Live Server** do VS Code. Não abra o arquivo diretamente como `file://`: o catálogo inicial é carregado por `fetch`. Para iniciar o servidor Harmonette legado, use `npm.cmd run legacy`; ele continua separado do Notarium.

## Organização do projeto

- Os arquivos principais do Notarium ficam soltos na raiz: interface, estilos, módulos JavaScript, servidor, build, banco de dados e catálogo inicial.
- Bibliotecas usadas pelo navegador ficam soltas na raiz como arquivos JavaScript separados.
- Não há pastas de origem para arquivos do Harmonette.

Os arquivos de configuração do npm e do Netlify ficam na raiz para que as ferramentas os encontrem automaticamente.

## Publicar na internet

O projeto oferece duas opções. Para publicar tudo junto em um serviço Node, use o blueprint `render.yaml`: ele instala as dependências, inicia o Notarium, verifica `/api/health` e guarda as contas e atividades em um disco persistente. Antes do primeiro login, configure o serviço com:

- `NODE_ENV=production`
- `NOTARIUM_DATA_FILE=/var/data/notarium-server-data.json`
- `PUBLIC_URL=https://SEU-DOMINIO/`
- CORS separado apenas quando o frontend estiver em domínio diferente.

Use um plano com disco persistente e faça backup do arquivo JSON antes de trocar de hospedagem. No primeiro acesso público, crie a conta de professor com uma senha forte. Os alunos só devem ser cadastrados depois da instalação.

Também é possível hospedar a interface no Netlify e a API em outro serviço Node com disco persistente:

1. Hospede `notarium-server.js` e configure `PUBLIC_URL` com a URL do site e `CORS_ORIGIN` com o domínio HTTPS exato do frontend. Não use `*` para contas autenticadas.
2. No Netlify, defina `NOTARIUM_API_URL` com a origem HTTPS da API, sem barra final.
3. Use o build `npm run build`; o `netlify.toml` publica os arquivos soltos na raiz.

No Netlify, a API é publicada automaticamente em `/api/*` como Netlify Function. As contas, sessões e atividades são salvas no Netlify Database, e os arquivos enviados ficam no Netlify Blobs. Não é necessário configurar uma API externa nem abrir ou editar arquivos JSON. No primeiro acesso de uma instalação nova, crie a conta de professor na própria tela. Os arquivos de dados do servidor local não são publicados nem importados automaticamente. O build publica somente a pasta `dist`, sem os arquivos internos de contas e backups.

## Conteúdo e dados

- Crie blocos de aulas, aulas com conteúdo em blocos, blocos de exercícios e atividades. Organize os exercícios em grupos antes de criá-los e relacione-os às aulas quando necessário.
- Ao adicionar materiais no editor de aulas e exercícios, escolha entre enviar um arquivo ou informar um link. Imagens, áudio, vídeos e PDFs são apresentados em formatos adequados, com opção de abrir ou baixar quando aplicável.
- Os arquivos enviados ficam no IndexedDB deste navegador, com limite de 15 MB por arquivo e sujeitos ao espaço disponível. Os links continuam dependendo de estarem acessíveis; partituras carregadas por arquivo ou URL precisam ser MusicXML válido e ter até 5 MB. Arquivos `.mxl` são aceitos no envio.
- Os exercícios suportam múltipla escolha, verdadeiro/falso, respostas escritas, acordes no piano, reconhecimento auditivo e partituras MusicXML/XML ou MXL.
- A leitura rítmica usa partitura MusicXML: o aluno inicia após a contagem audível de quatro tempos e toca um único botão para cada batida; erros, tempos e repetições permitidas ficam no relatório da resposta.
- Configure acordes com notas, intervalos, sequência de montagem, dicas por etapa e critério de correção. No critério por notas, o professor pode ativar ou desativar equivalências enarmônicas (como C# e Db); por padrão, elas são aceitas. O piano permite ajustar o volume e reproduzir as notas selecionadas e o acorde montado. Clique no piano ou em uma tecla para ativar os atalhos: C, D, E, F, G, A e B tocam a primeira oitava; Shift+C, Shift+D, Shift+E, Shift+F, Shift+G, Shift+A e Shift+B tocam a seguinte; 1 a 5 acionam as teclas pretas, com Shift para a oitava seguinte.
- No exercício de acorde, digite notas separadas por espaços (por exemplo, `C E G`, `Bb D F` ou `F#5 A5 C#6`) ou selecione-as no piano. A oitava é opcional e usa C4 por padrão; altere a oitava padrão em **Configurações**. O editor diferencia acordes em qualquer ordem, sequências didáticas e disposições/inversões específicas.
- O perfil local permite editar nome, @usuário, biografia e avatar; todos os perfis são públicos e não há opção de privacidade.
- Na aba **Trilha**, crie percursos diferentes para cada aluno de demonstração. Cada etapa pode ter nome, descrição, figura rítmica desenhada como notação musical, escolha entre nota, pausa ou sequência automática de melodia e pausas, e atalho para um bloco de aulas ou diretamente para uma aula. Configure por aluno o título da composição (ou sorteie sugestões como “Concerto da Aurora”), a clave de sol, dó ou fá, a armadura em tonalidade maior ou menor e a fórmula de compasso. A pauta mostra as notas em posições melódicas dentro do pentagrama, pausas, acidentes, compasso e barras de compasso; colcheias e semicolcheias são agrupadas sem atravessar os tempos (em 6/8, 9/8 e 12/8, cada grupo de três colcheias forma um tempo composto). A legenda mostra as cinco figuras e suas pausas correspondentes. Cada cartão curto sob uma nota abre os detalhes da etapa, seu bloco/aula e o estado atual. Na visualização de aluno, as etapas podem ser iniciadas, concluídas ou retomadas; o botão de acesso leva ao conteúdo relacionado. Notas que atravessam barras de compasso são divididas e ligadas, e algumas frases recebem ligaduras de expressão. As escolhas, a ordem e o progresso ficam salvos neste navegador.
- A navegação tem uma aba independente **Grupo**. Com uma conta online de professor, ela mostra alunos reais cadastrados, presença e progresso calculado pelas respostas do servidor. No modo local, ela usa a visualização de demonstração fictícia separada dos dados reais.
- Cada exercício pode ficar em rascunho, publicado, encerrado ou arquivado. Respostas objetivas e musicais são corrigidas segundo o gabarito e os critérios configurados; respostas que exigem avaliação humana permanecem pendentes até a correção manual.
- No editor, use **Salvar rascunho** para guardar uma atividade incompleta e continuar depois. Para publicar, escolha **Publicado** e use o botão de publicação; avisos de validação aparecem dentro do editor, desaparecem após alguns segundos e levam ao campo que precisa de atenção.
- Ao digitar acordes no enunciado, a assistência musical oferece símbolos como ♯, ♭, ♮, ♭5, ♯5, ♭9 e ♯9. Selecione um trecho para aplicar negrito ou escolher uma cor; a formatação é preservada e exibida com segurança para os alunos.
- Na aba **Grupo**, a conta de professor pode abrir **Respostas** para revisar participação, aproveitamento, pontuações, dificuldades por questão, respostas individuais e gráficos. Respostas pendentes não são contadas como incorretas.
- Tema claro/escuro e perfil local ficam salvos neste navegador.
- Em **Configurações**, escolha o tema, a oitava padrão, a nota e o volume dos cliques. O som de interação vem habilitado por padrão em volume máximo.
- O catálogo inicial em `catalog.json` é vazio, sem exemplos apresentados como conteúdo real.

O modo local usa `localStorage` e IndexedDB, vinculados à origem usada pelo navegador. Contas online, alunos, exercícios e respostas são salvos pelo servidor Node em `NOTARIUM_DATA_FILE`. Os dados demonstrativos antigos ficam restritos ao modo local; as telas conectadas a uma conta usam alunos, acessos e respostas reais.

## Limitações e privacidade

No modo local, o perfil professor/aluno é apenas uma visualização do navegador. O grupo fictício e seus indicadores existem somente para demonstração. Com uma conta online, senhas, alunos, conteúdo, mídias, notificações, respostas e presenças são controlados pelo servidor. Gere HTTPS, um domínio público e armazenamento persistente antes de compartilhar o acesso.

Os arquivos do Harmonette legado foram mantidos na raiz como `legacy-server.js`, `legacy-app.js`, `legacy-platform.js`, `legacy-app.css` e `legacy-style.css`; seus dados ficam em `database.json`. Eles não são usados pelo Notarium nem importados automaticamente. A aplicação atual não envia os dados locais para esse servidor. Backups locais podem ser guardados diretamente na raiz do projeto.

## Requisitos

- Node.js e npm para iniciar o servidor local e instalar as bibliotecas de partituras.
- Visual Studio Code com Live Server (opcional).
- Navegador moderno; Web Audio é necessário para ouvir o piano.
