# SD Gamble

> Demonstração de uma arquitetura distribuída para jogos de cassino em tempo real, com interface em React, comunicação via Socket.IO, API REST em Express e persistência em PostgreSQL/Supabase.

## Visão geral

O projeto disponibiliza três jogos:

| Jogo | Funcionamento demonstrado |
| --- | --- |
| **Crash** | Rodadas compartilhadas com contagem regressiva, multiplicador oficial calculado no servidor, retirada manual ou automática e encerramento ao atingir o ponto de crash. |
| **Mines** | Tabuleiro de 25 casas com 1 a 24 minas, abertura de casas, multiplicador progressivo e saque após ao menos uma casa segura. |
| **Double** | Escolha entre vermelho, preto e verde, resultado revelado após o giro. |

Além da experiência dos jogos, a interface mostra o estado das conexões, eventos Socket.IO, logs do servidor, logs da API e histórico persistido das rodadas para melhor demonstração da implementação.

## Arquitetura

```mermaid
flowchart LR
    B[Browser<br/>React + Vite] -->|REST: saúde, histórico e logs| A[API Express]
    B <-->|Socket.IO: comandos e eventos| G[Servidor dos jogos]
    A --> P[(PostgreSQL / Supabase)]
    G --> P

    subgraph Backend Node.js
      A
      G
    end
```

No estado atual do projeto, a API REST e o motor Socket.IO executam no mesmo processo Node.js (`backend/src/index.js`), porém cumprem responsabilidades distintas:

- **Interface (`interface/`)**: exibe dados, envia intenções do jogador e apresenta painéis de depuração.
- **API REST (`backend/`)**: disponibiliza saúde, histórico e logs persistidos.
- **Motor de jogos (`backend/`)**: valida ações, gera resultados, controla o ciclo do Crash e emite eventos em tempo real.
- **Banco de dados (`supabase/`)**: armazena rodadas encerradas e logs de auditoria.

## Tecnologias

- **Frontend:** React 18, Vite e Socket.IO Client
- **Backend:** Node.js, Express, Socket.IO, `pg` e `dotenv`
- **Banco:** PostgreSQL hospedado no Supabase ou instância PostgreSQL compatível
- **Comunicação:** REST para consulta e Socket.IO para eventos em tempo real

## Pré-requisitos

- Node.js **20 ou superior**
- npm
- Um banco PostgreSQL acessível, preferencialmente um projeto Supabase

## Configuração do banco de dados

1. Crie um projeto no Supabase ou disponibilize uma instância PostgreSQL.
2. Abra o SQL Editor do Supabase.
3. Execute o conteúdo de [`supabase/schema.sql`](./supabase/schema.sql).
4. Copie a string de conexão PostgreSQL e configure-a no arquivo `backend/.env`.

O schema cria as seguintes tabelas:

- `crash_rounds`: rodadas concluídas de Crash;
- `mines_games`: partidas concluídas de Mines;
- `double_rounds`: rodadas concluídas de Double;
- `audit_logs`: rastreabilidade de ações da API e do motor de jogos.

## Variáveis de ambiente

Crie os arquivos `.env` a partir dos exemplos existentes.

### macOS / Linux

```bash
cp backend/.env.example backend/.env
cp interface/.env.example interface/.env
```

### Windows PowerShell

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item interface/.env.example interface/.env
```

### Backend - `backend/.env`

```env
PORT=4000
NODE_ENV=development

DATABASE_URL=postgresql://USUARIO:SENHA@HOST:PORT/postgres
DATABASE_SSL=false

CORS_ORIGINS=http://localhost:5173
CRASH_GROWTH_RATE=0.06
```

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta HTTP e Socket.IO do backend. O padrão é `4000`. |
| `DATABASE_URL` | String de conexão PostgreSQL |
| `DATABASE_SSL` | Use `false` somente para PostgreSQL local sem TLS. Para Supabase/ambiente hospedado, use `true` ou remova a variável. |
| `CORS_ORIGINS` | Origens de frontend permitidas, separadas por vírgula. |
| `CRASH_GROWTH_RATE` | Taxa de crescimento exponencial do multiplicador no Crash. |

### Frontend - `interface/.env`

```env
VITE_BACKEND_URL=http://localhost:4000
```

Em produção, substitua a URL pelo endereço público do backend.

## Instalação e execução local

Na raiz do projeto, instale as dependências dos dois módulos:

```bash
npm run install:all
```

Em seguida, mantenha dois terminais abertos.

**Terminal 1 - backend**

```bash
npm run dev:backend
```

**Terminal 2 - interface**

```bash
npm run dev:web
```

Acesse a interface em:

```text
http://localhost:5173
```

O backend estará disponível em:

```text
http://localhost:4000
```

## API REST

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/health` | Verifica se o backend e o banco estão disponíveis. |
| `GET` | `/api/rounds/history` | Retorna as 10 últimas rodadas de Crash persistidas. |
| `GET` | `/api/mines/history` | Retorna as 10 últimas partidas de Mines persistidas. |
| `GET` | `/api/double/history` | Retorna as 10 últimas rodadas de Double persistidas. |
| `GET` | `/api/logs?game={jogo}&source={origem}` | Retorna até 10 logs de auditoria filtrados por jogo e/ou origem. |

## Eventos Socket.IO principais

### Eventos enviados pela interface

| Jogo | Evento | Payload principal |
| --- | --- | --- |
| Crash | `crash_place_bet` | `{ amount, autoCashOut }` |
| Crash | `crash_cancel_bet` | sem payload |
| Crash | `crash_cash_out` | sem payload |
| Mines | `mines_start_game` | `{ minesCount }` |
| Mines | `mines_reveal_tile` | `{ tileIndex }` |
| Mines | `mines_cash_out` | sem payload |
| Double | `double_start_round` | `{ selectedColor }` |

### Eventos recebidos da aplicação

| Jogo / sistema | Eventos relevantes |
| --- | --- |
| Sistema | `server_snapshot`, `server_logs_snapshot`, `game_server_log` |
| Crash | `round_waiting`, `round_started`, `multiplier_update`, `round_crashed`, `crash_bet_*`, `crash_error` |
| Mines | `mines_game_started`, `mines_tile_revealed`, `mines_game_lost`, `mines_game_cashed_out`, `mines_error` |
| Double | `double_round_started`, `double_round_finished`, `double_error` |

## Compromisso e revelação dos resultados

Os três jogos usam um mecanismo demonstrativo de compromisso e revelação para deixar explícito que o resultado permanece no servidor até o momento apropriado. Esse mecanismo foi inspirado (com simplificações) na ideia de "provably fair" usada por casas de apostas reais e segue o fluxo:

1. O backend gera um `serverSeed` aleatório e um `publicSeed`.
2. Antes da revelação, o frontend recebe apenas o compromisso `SHA-256(serverSeed)`.
3. O resultado é derivado no servidor com HMAC-SHA256.
4. Ao encerrar a rodada ou partida, o backend revela `serverSeed` e `publicSeed` junto do compromisso original.

## Estrutura de diretórios

```text
sd-gamble-main/
├── backend/
│   ├── src/
│   │   ├── index.js            # API REST, Socket.IO e regras dos jogos
│   │   └── db.js               # Pool PostgreSQL e persistência
│   ├── .env.example
│   └── package.json
├── interface/
│   ├── src/
│   │   ├── games/              # Telas Crash, Mines e Double
│   │   ├── components/         # Componentes reutilizáveis de interface
│   │   ├── styles/             # Estilos separados por responsabilidade
│   │   ├── App.jsx             # Navegação principal
│   │   └── main.jsx            # Inicialização React
│   ├── .env.example
│   └── package.json
├── supabase/
│   └── schema.sql              # Schema e índices do PostgreSQL
├── package.json
└── README.md
```

## Limitações intencionais

- Não há autenticação, usuários, carteira ou saldo persistido, logo, as interações são compartilhadas.
