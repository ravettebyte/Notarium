# Operação de backup e recuperação

## Agendamento e armazenamento

O deploy de produção agenda `daily-backup` às 03h UTC todos os dias e `verify-restore` aos domingos às 04h UTC. Os agendadores criam autorizações de uso único no banco e despacham `backup-worker-background`, evitando o limite curto das funções agendadas. Uma solicitação pública sem autorização válida não executa a manutenção. Uma autorização expira em 15 minutos e é consumida antes de começar.

O backup usa uma leitura consistente das tabelas, copia os arquivos referenciados para o armazenamento privado separado `notarium-backups`, valida SHA-256 e leitura do gzip e publica o manifesto somente ao concluir tudo. Nenhuma falha substitui a última cópia válida. O monitor em Configurações mostra início, fim, estado e verificação de restauração. Falhas geram notificações aos professores; logs não incluem conteúdo, credenciais ou respostas dos alunos. Um trabalho encerrado abruptamente pela infraestrutura pode permanecer `running`; investigue execuções antigas nesse estado e preserve a cópia anterior.

A retenção padrão é de 30 dias, com pelo menos as 30 últimas cópias completas. `BACKUP_RETENTION_DAYS` pode ampliar o período, até 3650 dias. Cópias dominicais e do primeiro dia do mês são preservadas como checkpoints adicionais; não têm expiração automática nesta versão. Objetos parciais de trabalhos falhos e versões antigas de uploads também requerem limpeza operacional posterior. Isso pode aumentar custos.

Backups e arquivos usam armazenamento persistente do próprio Netlify, independente do servidor e dos deploys, mas compartilham a mesma conta/provedor. Não protegem sozinhos contra perda total da conta Netlify. Baixe periodicamente uma cópia privada para um local seguro, com criptografia e acesso restrito. Não envie ao GitHub.

## Teste isolado

O trabalho semanal abre uma instância PostgreSQL descartável em memória, aplica nela o schema de restauração e insere os registros na ordem das referências. Confere contagens e checksums dos arquivos. Registra `verified_at` apenas se o processo completo funcionar. A instância é fechada ao final e não é conectada à produção. A verificação comprova a restauração da aplicação e a integridade dos arquivos; não recria credenciais Identity nem valida e-mails.

Para repetir fora da infraestrutura:

1. Entre como administrador. Em Configurações, consulte os backups e baixe uma cópia completa privada. O navegador reúne manifesto, snapshot e arquivos em ZIP; downloads grandes exigem memória disponível.
2. Em um computador confiável, obtenha o código do repositório privado e use a versão compatível com o backup. Execute `npm ci`.
3. Mantenha o ZIP fora do repositório e da pasta publicada.
4. Execute `node scripts/restore-check.mjs /caminho/privado/copia.zip /caminho/privado/teste-novo`. O destino precisa ser inexistente. O comando não oferece conexão com produção nem opção de sobrescrever um ambiente existente.
5. Confira o código de saída e o arquivo `verification.json` no destino. O diretório contém um PostgreSQL PGlite restaurado e os arquivos verificados, com permissões locais restritas. Não publique esse diretório.
6. Registre a data e o resultado no controle operacional da organização. Apague o ambiente de teste de forma segura quando não for mais necessário.

## Recuperação no mesmo projeto Netlify

1. Interrompa novas alterações e preserve o estado atual, inclusive backups anteriores. Identifique a última cópia completa e verificada.
2. Recupere o código pelo GitHub e selecione uma versão compatível. As migrações são cumulativas; não reverta schema automaticamente ao reverter frontend.
3. Prepare uma homologação isolada. Use Database de homologação e armazenamento de arquivos separado. O namespace dos arquivos acompanha o contexto/branch de operação. Não aponte homologação para a produção.
4. Execute o teste isolado acima antes de qualquer restauração operacional.
5. Para perda do banco gerenciado, solicite ao operador autorizado a restauração do PostgreSQL em uma branch nova usando os recursos de recuperação do serviço. Preserve IDs. O snapshot JSON contém tabelas e valores, e `restoreInto` define a ordem e inserções parametrizadas; não existe endpoint público de restauração destrutiva.
6. Reponha no armazenamento de arquivos os objetos do ZIP com as chaves `blobKey` originais e valide os checksums. Preserve os registros da tabela `media`; eles mantêm o vínculo com aulas, exercícios e proprietários. Um operador autorizado precisa executar essa reimportação: a ferramenta entregue é de teste, não restaura produção automaticamente.
7. Se o Identity original foi preservado, os IDs devem continuar iguais e as contas podem recuperar a senha por e-mail. Verifique as permissões antes de abrir o acesso. Se o Identity foi perdido, não declare recuperação completa: é necessário recriar as identidades e remapear as referências, com procedimento assistido ainda pendente de automação.
8. Aplique novas migrações pelo fluxo de deploy. Confira login de professor e aluno, restrições entre dois alunos, quantidade de aulas e respostas, notas, download de um arquivo de cada tipo, composições e notificações.
9. Publique apenas após validar. Confira HTTPS e redirecionamento de domínio no painel da hospedagem. Faça um novo backup e confira seu teste de restauração.

## Mudança de provedor

PostgreSQL e os bytes dos arquivos são portáveis, e o ZIP não contém credenciais de implantação. Entretanto, a API usa o runtime Netlify para Identity, Database e Blobs. Migrar exige adaptar esses três conectores, o mecanismo de agendamento e a autenticação. O código não implementa uma migração automática para outra hospedagem.

Prepare um PostgreSQL novo, aplique as migrações em ambiente isolado, importe os registros preservando IDs, restaure arquivos em armazenamento privado e adapte os endpoints para validar o novo provedor de identidade. Se ele não aceitar as identidades atuais, recrie-as por recuperação segura e remapeie todas as referências. Configure as credenciais somente no cofre do novo ambiente. Repita os testes com dados de teste antes de alterar DNS. Não desligue o provedor anterior antes de testar a restauração e guardar uma segunda cópia independente.

## Dados antigos

Os arquivos de dados e backups que já existiam no projeto foram preservados. Eles não foram executados nem migrados automaticamente, porque podem conter informações reais, credenciais antigas ou estruturas incompatíveis. Não misture esses usuários com as novas contas sem validar e-mails, consentimento e autoria.

Para conteúdo, exporte uma cópia dos dados antigos, valide em homologação e importe pelo mecanismo autorizado de conteúdo quando disponível. A função `importModel` aceita JSON/JSON5 sem executar código. O banco novo não reutiliza os hashes antigos; usuários precisam de contas Identity controladas e recuperação de senha. Não apague a fonte original antes de conferir aulas, materiais, notas e relacionamentos restaurados.
