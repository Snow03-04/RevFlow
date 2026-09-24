# RevFlow — instalação independente no localhost

Esta cópia contém a aplicação e o esquema da base de dados. Não contém contas,
lojas, encomendas, dados de anúncios, credenciais, sessões nem histórico Git da
instalação de origem. Os dados dos testes são fictícios.

A aplicação corre no teu computador, mas precisa de internet e de um projeto
Supabase teu. Não é uma aplicação totalmente offline nem vem com contas ligadas.

## 1. Instalar e criar a configuração

Instala Node.js 22 ou superior e abre um terminal dentro da pasta `RevFlow`:

```powershell
npm ci
npm run setup:local
```

O segundo comando cria `.env.local` a partir de `.env.example` e gera novas
chaves de encriptação e de proteção do cron. Se o ficheiro já existir, mantém-no.
Não partilhes o `.env.local` e não alteres a chave de encriptação depois de ligar
contas, pois os tokens guardados dependem dela.

## 2. Criar a tua base de dados

1. Cria um projeto em [Supabase](https://supabase.com/dashboard).
2. No SQL Editor desse projeto novo, executa os ficheiros de
   `supabase/migrations` por ordem do nome: de `0001` até `0036`, todos incluídos.
   O ZIP inclui também `supabase/INSTALL.sql`, que junta essas mesmas migrações;
   podes executá-lo uma vez em alternativa. Não executes as duas opções.
3. Em Authentication → URL Configuration, usa `http://localhost:3000` como Site
   URL e adiciona `http://localhost:3000/auth/callback` aos Redirect URLs.
4. Ativa o login por email. O login com Google é opcional e requer o teu próprio
   cliente OAuth configurado no Supabase.
5. Preenche no `.env.local` as credenciais desse projeto:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
   `SUPABASE_SERVICE_ROLE_KEY`. Usa a chave pública anon no browser, nunca a
   service role. As restantes chaves geradas pelo instalador são próprias desta
   instalação.

O `INSTALL.sql` cria apenas a estrutura e as regras da aplicação. Não importa
registos da instalação de origem. Usa-o num projeto novo, não numa base de dados
com migrações já aplicadas.

## 3. Abrir a aplicação

```powershell
npm run dev:local
```

Abre **http://localhost:3000**, cria a tua conta e confirma o email se solicitado.
Mantém o terminal aberto. O comando usa HTTP e escuta apenas em `127.0.0.1`.
Não uses `https://localhost:3000` sem configurar um certificado teu.

Sem integrações ligadas, é normal o dashboard estar vazio. Não há modo de acesso
à conta do autor nem cópia dos seus dados.

## 4. Ligar as tuas contas

- **Shopify:** em Connections, usa as opções disponíveis para a tua loja. OAuth
  requer `SHOPIFY_API_KEY` e `SHOPIFY_API_SECRET` da tua aplicação e o respetivo
  callback `/api/shopify/callback`. A opção de token usa as credenciais da tua loja.
- **Meta Ads:** configura `META_APP_ID` e `META_APP_SECRET` da tua aplicação,
  permite o callback `/api/meta/callback` e liga a tua conta em Connections.
- **Google Ads por script:** gera um script novo em Connections depois de ligar
  a tua loja. O script contém uma autorização para essa loja: mantém-no privado.
  Não uses scripts copiados de outra instalação.
- **Assistente:** a chave Gemini é opcional e é configurada pelo utilizador em
  Settings. Não há uma chave de IA partilhada neste pacote.

Os fornecedores podem exigir um callback HTTPS público. Configura as URLs
aceites na tua própria aplicação e reinicia o RevFlow depois de alterar o env.

### Google Ads e localhost

O Google executa o script nos servidores dele: não consegue enviar pedidos para
o `localhost` do teu computador. Antes de usar o script, escolhe uma opção:

- Um servidor RevFlow teu, acessível por HTTPS, com o mesmo Supabase e a mesma
  chave de encriptação da tua instalação local; ou
- Um túnel HTTPS que encaminhe para o teu servidor local na porta 3000, enquanto
  o computador e a aplicação estiverem ligados.

Define `GOOGLE_ADS_SCRIPT_APP_URL` com essa URL HTTPS pública, sem caminho final.
Mantém `NEXT_PUBLIC_APP_URL=http://localhost:3000` se apenas o destino do script
mudar. Reinicia a aplicação, gera novamente o script e instala-o na conta Google
Ads correspondente. Executa uma vez, verifica o registo e agenda de hora a hora.
Se o endereço do túnel mudar, atualiza a configuração e o script.

As variáveis `GOOGLE_ADS_SCRIPT_LOCAL_URL` e `GOOGLE_ADS_SCRIPT_LOCAL_STORE_ID`
são para um destino local adicional; deixa-as vazias numa instalação simples.
Google Ads via OAuth é uma alternativa e exige as tuas próprias credenciais
`GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET` e `GOOGLE_ADS_DEVELOPER_TOKEN`.

### Limitação atual dos custos Google

O custo mostrado nas campanhas pode diferir do custo faturado. Promoções,
excesso de fornecimento e cliques inválidos são conceitos diferentes.

O script consulta custos e, quando autorizado pelo Google, o saldo promocional.
**Não importa automaticamente todos os ajustes finais da faturação.** Uma
promoção esgotada ou aplicada apenas a parte de um dia pode exigir reconciliação
antes de confirmar a despesa. Os dias pendentes mantêm aviso; o dashboard pode
mostrar custo e lucro estimados com base no gasto recebido.

Confere os dias relevantes na faturação do Google antes de usar o lucro como
valor final. Não deduzas outra vez uma promoção esgotada nem trates ausência de
dados como gasto zero. As correções feitas noutra instalação não vêm neste ZIP.
O Google usa o fuso da conta de anúncios; confirma também o fuso das lojas ao
comparar dias.

## 5. Atualizações e verificações

No localhost, usa **Sync now** para atualizar os dados. O agendamento da Netlify
incluído em `netlify/functions` não corre automaticamente no teu computador.
Webhooks Shopify também precisam de um endereço público acessível.

```powershell
npm run typecheck
node --test tests/*.test.cjs
npm run build
```

Para iniciar a versão compilada: `npm run start -- --hostname 127.0.0.1`.
Para alojamento público e configuração adicional, consulta `DEPLOYMENT.md`.

## Conteúdo excluído da partilha

Não são incluídos `.env.local`, `.git`, `node_modules`, `.next`, certificados,
chaves, logs, backups, exportações da base de dados ou pastas de trabalho locais.
O único ficheiro de ambiente incluído é `.env.example`, com valores de exemplo.
As dependências são instaladas pelo destinatário com `npm ci`.
