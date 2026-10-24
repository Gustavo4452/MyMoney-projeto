# MyMoney

Aplicativo local de controle financeiro. A interface existente usa HTML, CSS e JavaScript sem framework; o servidor usa Node.js, o módulo nativo SQLite e armazenamento local, sem dependências npm externas.

## Requisitos

- Node.js 22.13 ou superior.

## Executar localmente

No terminal, dentro da pasta `ideias-investimento-site`:

```sh
npm start
```

Abra `http://localhost:3000`, crie uma conta e acesse seu painel. O banco SQLite é criado em `data/mymoney.sqlite` na primeira execução.

No cabeçalho do painel, **Controle de gastos** abre uma página própria em uma nova aba para registrar compras manualmente ou ler QR codes e códigos de barras com a câmera, quando o navegador oferece `BarcodeDetector`. **Histórico** abre na aba atual uma página dedicada com os registros salvos, filtros por mês/categoria e paginação. A leitura só preenche o campo de código: descrição, categoria, data e valor são informados no formulário; não há consulta automática de produtos ou preços. A câmera requer permissão do usuário e HTTPS ou `localhost`. Quando o navegador não oferece leitura compatível, ainda é possível digitar o código ou registrar a compra sem código.

Na seção **Ideias de estudo**, cada fundo tem a opção **Ver estatísticas detalhadas**, que abre os indicadores disponíveis no painel, junto com explicações e avisos sobre suas fontes e limitações. Os dados são material de estudo e devem ser confirmados em fontes oficiais.

## Publicar no Render

O arquivo `render.yaml` configura o serviço Node.js, o endpoint de saúde e um disco persistente para o SQLite em `/var/data/mymoney.sqlite`. O plano `starter` e o disco persistente são recursos pagos do Render; revise os valores atuais no painel antes de criar o serviço.

1. No Render, escolha **New > Blueprint** e conecte `Gustavo4452/MyMoney-projeto`.
2. Revise a configuração do Blueprint e o custo do serviço/disco antes de confirmar.
3. Depois que o deploy terminar, abra o endereço `.onrender.com` indicado pelo Render, crie sua conta e teste login, perfil e histórico.

O banco local do desenvolvedor não é enviado ao GitHub. O serviço hospedado inicia com um banco vazio e mantém os dados novos no disco persistente.

## Executar os testes

```sh
npm test
```

Os testes cobrem cadastro e validação, login válido e inválido, proteção de rotas, das páginas de gastos e histórico, separação dos dados financeiros e dos gastos por usuário, registro, filtros, paginação e exclusão de despesas, alteração de perfil e senha, logout e limitação de tentativas.

## Segurança e limites

- As senhas são armazenadas como derivação scrypt com salt aleatório; nunca são persistidas em texto puro.
- A sessão usa token aleatório em cookie `HttpOnly`, `SameSite=Strict` e expira em sete dias. Em `NODE_ENV=production`, o cookie também recebe `Secure`; produção exige HTTPS.
- Cinco falhas de login por endereço em 15 minutos acionam bloqueio temporário. A resposta de credenciais inválidas não revela se o e-mail está cadastrado.
- O banco, as contas e os perfis financeiros são locais. O app não processa transações bancárias nem sincroniza dados com um serviço externo.
- Antes de disponibilizar publicamente, configure HTTPS, backups protegidos e uma estratégia adequada de gerenciamento e recuperação do banco. O servidor incluído foi preparado para desenvolvimento local, não como implantação de produção completa.
