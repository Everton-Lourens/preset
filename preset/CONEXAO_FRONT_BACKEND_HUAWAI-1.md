# Conexão entre Front e Backend — huawai_auto

Este documento explica, de forma prática, como o front conversa com o backend, quais endpoints existem, quais bodies eles esperam, quais respostas retornam e como cada input da interface se liga ao backend.

---

## 1) Visão geral do funcionamento

O projeto expõe um servidor HTTP local em:

- **Host:** `127.0.0.1`
- **Porta:** `7777`

Base URL padrão:

```text
http://127.0.0.1:7777
```

O front faz quatro tipos de comunicação com o backend:

1. **Consulta de saúde**
   - `GET /health`

2. **Consulta de estado da aplicação**
   - `GET /api/status`

3. **Execução de ações**
   - `POST /api/preset`
   - `POST /api/update-onu`

4. **Atualização em tempo real**
   - `GET /api/stream` via SSE
   - `GET /api/browser-stream` via SSE

---

## 2) Regra de acesso

Antes de acessar o painel e as rotas protegidas, o backend exige um **código de acesso**.

### Rotas protegidas
- `/`
- `/styles.css`
- qualquer rota sob `/api/*`

### Como o acesso funciona
O backend aceita o código de duas formas:

- `?code=...` na URL
- cookie `router_access`

Quando o front abre a aplicação com `?code=`, o backend valida o código e grava o cookie. Depois disso, os próximos acessos podem seguir pelo cookie.

### Observação importante para o front
O front já foi preparado para ler `code` da query string e reaproveitá-lo em todas as chamadas com a função:

```javascript
apiUrl(path)
```

Ela acrescenta `?code=...` automaticamente em:
- `fetch(...)`
- `EventSource(...)`

### Ponto crítico para integração externa
Se o front estiver em **outra origem** diferente do backend, o navegador pode bloquear as requisições por **CORS**.  
O servidor atual só responde o `OPTIONS` de preflight em `/api/*`, mas **não envia `Access-Control-Allow-Origin` nas respostas normais**.  
Então, para funcionar fora da mesma origem, você precisa:

- servir o front pelo mesmo backend, ou
- adicionar CORS completo no backend, ou
- usar proxy/reverse proxy no APK/app.

---

## 3) Mapeamento dos inputs do front para o backend

| Input / Ação no front | Campo enviado | Endpoint | Observação |
|---|---|---|---|
| `routerPassword` | `inputPassword` | `POST /api/preset` | Senha do roteador |
| `emailPPPoEInput` | `emailPPPoEInput` | `POST /api/preset` | Optional |
| `passwordPPPoEInput` | `passwordPPPoEInput` | `POST /api/preset` | Optional |
| `wifiName` | `wifiName` | `POST /api/preset` | SSID |
| `wifiPassword` | `wifiPassword` | `POST /api/preset` | Senha Wi-Fi |
| Botão **Preset Huawei** | dispara `POST /api/preset` | `POST /api/preset` | Inicia o fluxo principal |
| Botão **Update ONU** | dispara `POST /api/update-onu` | `POST /api/update-onu` | Fluxo separado |
| Painel de status | lê `GET /api/status` | `GET /api/status` | Atualização manual/automática |
| Console ao vivo | assina `GET /api/stream` | SSE | Logs e status |
| Espelho do browser | assina `GET /api/browser-stream` | SSE | Frames ao vivo do Puppeteer |

---

## 4) Endpoint `GET /health`

### Finalidade
Checagem simples se o backend está de pé.

### Request
```http
GET /health
```

### Response 200
```json
{
  "status": "ok",
  "uptime": 1234,
  "timestamp": "2026-07-06T12:34:56.000Z"
}
```

### Uso prático
Use esse endpoint para:
- testar se o serviço iniciou
- checar se o processo está vivo
- validar se o APK conseguiu atingir o backend

---

## 5) Endpoint `GET /api/status`

### Finalidade
Retorna o estado atual do serviço e das execuções.

### Request
```http
GET /api/status?code=SEU_CODIGO
```

### Response 200
Estrutura principal:

```json
{
  "ok": true,
  "service": "running",
  "host": "127.0.0.1",
  "port": 7777,
  "presetRunning": false,
  "onuRunning": false,
  "state": {
    "status": "idle",
    "message": "Aguardando execução",
    "startedAt": null,
    "finishedAt": null,
    "runId": null
  },
  "onuState": {
    "status": "idle",
    "message": "Aguardando execução",
    "startedAt": null,
    "finishedAt": null,
    "runId": null
  },
  "browserView": {
    "active": false,
    "status": "idle",
    "label": "Aguardando execução",
    "runId": null,
    "startedAt": null,
    "finishedAt": null,
    "lastFrameAt": null,
    "lastFrameLabel": null,
    "reason": null
  }
}
```

### O que o front usa daqui
- estado do backend
- se o preset está rodando
- se a ONU está rodando
- texto do último status
- estado do espelho ao vivo

---

## 6) SSE `GET /api/stream`

### Finalidade
Canal em tempo real para:
- logs
- status do serviço

### Request
```http
GET /api/stream?code=SEU_CODIGO
```

### Eventos enviados

#### `log`
Envia entradas do console.

Exemplo:
```json
{
  "timestamp": "2026-07-06T12:34:56.000Z",
  "level": "log",
  "message": "[HTTP] Servidor iniciado..."
}
```

#### `status`
Envia o mesmo payload de `GET /api/status`.

### Comportamento ao conectar
O backend:
- envia o histórico de logs já acumulado
- envia um `status` inicial
- mantém a conexão viva com heartbeat

### Uso no front
O front usa `EventSource` e atualiza:
- contador de estado
- log visual
- estado dos botões
- mensagem final da execução

---

## 7) SSE `GET /api/browser-stream`

### Finalidade
Canal em tempo real para o espelho visual do Puppeteer.

Esse stream é o que resolve a parte dos **prints em tempo real**.  
O backend já publica um frame novo sempre que ocorre uma ação importante no fluxo, como:

- carregar uma página
- clicar em um botão
- trocar de menu
- salvar um formulário
- confirmar envio
- concluir um fluxo

Ou seja: o APK **não precisa criar o print**. Ele só precisa **escutar** o stream e renderizar a imagem base64 que chega do backend.

### Request
```http
GET /api/browser-stream?code=SEU_CODIGO
```

### Eventos enviados

#### `browser-session`
Envia o estado da sessão do browser.

Exemplo:
```json
{
  "ok": true,
  "browserView": {
    "active": true,
    "status": "running",
    "label": "Fluxo do preset",
    "runId": "run-1-1710...",
    "startedAt": "2026-07-06T12:34:56.000Z",
    "finishedAt": null,
    "lastFrameAt": null,
    "lastFrameLabel": null,
    "reason": null
  }
}
```

Esse evento serve para o APK saber:
- quando a visualização ao vivo abriu
- quando a execução começou
- quando terminou
- qual foi o último rótulo exibido
- se houve motivo de encerramento

#### `browser-frame`
Envia o frame atual do navegador em base64.

Exemplo resumido:
```json
{
  "ok": true,
  "timestamp": "2026-07-06T12:35:10.000Z",
  "browserView": {
    "active": true,
    "status": "running",
    "label": "Fluxo do preset",
    "runId": "run-1-1710...",
    "startedAt": "2026-07-06T12:34:56.000Z",
    "finishedAt": null,
    "lastFrameAt": "2026-07-06T12:35:10.000Z",
    "lastFrameLabel": "preset: upload do arquivo",
    "reason": null
  },
  "frame": {
    "label": "preset: upload do arquivo",
    "image": "<base64 jpeg>",
    "mimeType": "image/jpeg",
    "runId": "run-1-1710...",
    "pageUrl": "http://192.168.101.1/..."
  }
}
```

Esse evento é o que o APK deve usar para:
- trocar a imagem na tela
- mostrar o texto do passo atual
- manter o espelho sincronizado com cada clique relevante

### Regra de atualização do frame
O backend não manda vídeo contínuo.  
Ele manda **snapshots** em momentos estratégicos do fluxo.

Além disso, o backend limita a frequência mínima entre frames para evitar excesso de captura.  
Na prática, o comportamento esperado é:

- o fluxo clica
- o backend publica um novo `browser-frame`
- o APK troca a imagem atual
- chega outro clique
- outro `browser-frame` substitui o anterior

### Uso no front
O front transforma esse payload em:
- preview visual ao vivo
- título da execução
- metadados de início/fim
- imagem em base64

### Como implementar isso no APK

#### 1) Abrir o stream de console
O stream de console é o canal de texto em tempo real.  
Ele recebe tudo que o backend escreve com `console.log`, `console.info`, `console.warn` e `console.error`, porque o servidor intercepta o console com `patchConsole()` e transforma cada chamada em evento SSE `log`.

#### 2) Abrir o stream visual
O stream visual é o canal das imagens.  
Ele recebe os eventos `browser-session` e `browser-frame`, que devem ser tratados separadamente.

#### 3) Ouvir os eventos certos
O APK precisa registrar estes eventos:

- `log` → acrescenta linha no console do app
- `status` → atualiza o estado geral
- `browser-session` → abre/fecha a área do painel ao vivo
- `browser-frame` → atualiza a imagem exibida

#### 4) Não esperar resposta única
SSE fica aberto o tempo todo.  
O APK não deve fazer um `fetch` único para esperar o resultado.  
Ele deve manter a conexão persistente e reagir aos eventos conforme chegam.

#### 5) Reconnect automático
Se a conexão cair, o APK deve reconectar e, ao reconectar, chamar `/api/status` para sincronizar o estado atual.

### Exemplo de consumo em JavaScript
```javascript
const apiBase = 'http://127.0.0.1:7777';
const code = 'SEU_CODIGO';

const consoleStream = new EventSource(`${apiBase}/api/stream?code=${encodeURIComponent(code)}`);
consoleStream.addEventListener('log', (event) => {
  const data = JSON.parse(event.data);
  console.log(`[${data.level}]`, data.message);
});
consoleStream.addEventListener('status', (event) => {
  const data = JSON.parse(event.data);
  console.log('STATUS:', data);
});

const browserStream = new EventSource(`${apiBase}/api/browser-stream?code=${encodeURIComponent(code)}`);
browserStream.addEventListener('browser-session', (event) => {
  const data = JSON.parse(event.data);
  console.log('BROWSER SESSION:', data.browserView);
});
browserStream.addEventListener('browser-frame', (event) => {
  const data = JSON.parse(event.data);
  const { image, mimeType } = data.frame;

  const img = document.getElementById('liveFrame');
  img.src = `data:${mimeType};base64,${image}`;
});
```

### Se o APK for nativo
Se o APK não usar WebView, a regra é a mesma:

- abrir uma conexão SSE para `/api/stream`
- abrir outra SSE para `/api/browser-stream`
- tratar `log` como console textual
- tratar `browser-frame` como imagem
- atualizar a UI sem bloquear a execução
- manter a reconexão automática

---

## 8) Endpoint `POST /api/preset`


### Finalidade
Inicia o fluxo principal do preset.

### Request
```http
POST /api/preset?code=SEU_CODIGO
Content-Type: application/json
```

### Body esperado
```json
{
  "password": "50292230",
  "preset": true,
  "inputPassword": "SENHA_DO_ROTEADOR",
  "emailPPPoEInput": "email@exemplo.com",
  "passwordPPPoEInput": "senha_pppoe",
  "wifiName": "MinhaRede",
  "wifiPassword": "minha_senha_wifi"
}
```

### Significado de cada campo

- `password`
  - senha de autenticação da API
  - o front atual envia `50292230`
  - o backend compara com `PRESET_PASSWORD` ou com o valor padrão `50292230`

- `preset`
  - precisa ser `true`

- `inputPassword`
  - senha do roteador
  - vem do input `routerPassword`

- `emailPPPoEInput`
  - valor do login PPPoE, se existir

- `passwordPPPoEInput`
  - senha PPPoE, se existir

- `wifiName`
  - nome da rede Wi-Fi (SSID)

- `wifiPassword`
  - senha da rede Wi-Fi
  - espaços são removidos pelo front e também pelo backend
  - o backend aceita:
    - senha com mais de 8 caracteres e até 63
    - ou string hexadecimal de 64 caracteres

### Validações do backend
O backend rejeita o pedido se:

- o JSON for inválido
- `password` estiver errada
- `preset !== true`
- `inputPassword` estiver ausente
- `wifiName` tiver caracteres fora de ASCII imprimível
- `wifiPassword` for inválida

### Respostas

#### `202 Accepted`
Quando a execução foi aceita:

```json
{
  "ok": true,
  "message": "Preset aceito e iniciado.",
  "runId": "run-1-1710...",
  "startedAt": "2026-07-06T12:34:56.000Z",
  "statusUrl": "/api/status"
}
```

#### `400 Bad Request`
Exemplo de erro de validação:
```json
{
  "ok": false,
  "error": "Senha do roteador não informada.",
  "code": "MISSING_ROUTER_PASSWORD"
}
```

#### `401 Unauthorized`
Quando a senha da API estiver errada:
```json
{
  "ok": false,
  "error": "Senha inválida.",
  "code": "INVALID_PASSWORD"
}
```

#### `409 Conflict`
Quando já existe uma execução em andamento:
```json
{
  "ok": false,
  "error": "Já existe uma execução em andamento.",
  "code": "PRESET_RUNNING"
}
```

---

## 9) Endpoint `POST /api/update-onu`

### Finalidade
Inicia o fluxo separado de atualização da ONU.

### Request
```http
POST /api/update-onu?code=SEU_CODIGO
Content-Type: application/json
```

### Body esperado
```json
{
  "password": "50292230",
  "updateOnu": true
}
```

### Validações do backend
O backend rejeita o pedido se:

- o JSON for inválido
- `password` estiver errada
- `updateOnu !== true`
- já houver uma execução em andamento

### Respostas

#### `202 Accepted`
```json
{
  "ok": true,
  "message": "Atualização da ONU aceita e iniciada.",
  "runId": "run-2-1710...",
  "startedAt": "2026-07-06T12:34:56.000Z",
  "statusUrl": "/api/status"
}
```

#### `401 Unauthorized`
```json
{
  "ok": false,
  "error": "Senha inválida.",
  "code": "INVALID_PASSWORD"
}
```

#### `400 Bad Request`
```json
{
  "ok": false,
  "error": "O campo updateOnu deve ser true.",
  "code": "INVALID_UPDATE_ONU_FLAG"
}
```

#### `409 Conflict`
```json
{
  "ok": false,
  "error": "Já existe uma execução em andamento.",
  "code": "EXECUTION_IN_PROGRESS"
}
```

---

## 10) Como cada parte do front fala com o backend

### Fluxo do botão “Preset Huawei”

1. O usuário preenche:
   - senha do roteador
   - PPPoE, se houver
   - nome do Wi-Fi
   - senha do Wi-Fi

2. O front valida localmente:
   - nome do Wi-Fi precisa ser ASCII imprimível
   - senha Wi-Fi precisa respeitar as regras de tamanho/formato

3. O front monta o payload e chama:
   - `POST /api/preset`

4. O backend valida novamente.

5. Se estiver tudo certo, o backend responde `202` e dispara a automação.

6. O front mostra:
   - resposta JSON
   - estado atualizado
   - botões desabilitados durante a execução
   - console e espelho ao vivo via SSE

---

### Fluxo do botão “Update ONU”

1. O front monta:
   - `password`
   - `updateOnu: true`

2. Envia para:
   - `POST /api/update-onu`

3. O backend valida:
   - senha da API
   - flag `updateOnu`

4. Se autorizado, inicia a execução da ONU.

5. O front acompanha:
   - `GET /api/status`
   - `GET /api/stream`
   - `GET /api/browser-stream`

---

## 11) Exemplo de integração em JavaScript

### Preset
```javascript
async function startPreset({
  code,
  routerPassword,
  emailPPPoEInput,
  passwordPPPoEInput,
  wifiName,
  wifiPassword
}) {
  const res = await fetch(`http://127.0.0.1:7777/api/preset?code=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      password: '50292230',
      preset: true,
      inputPassword: routerPassword,
      emailPPPoEInput,
      passwordPPPoEInput,
      wifiName,
      wifiPassword
    })
  });

  return await res.json();
}
```

### Update ONU
```javascript
async function startUpdateOnu(code) {
  const res = await fetch(`http://127.0.0.1:7777/api/update-onu?code=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      password: '50292230',
      updateOnu: true
    })
  });

  return await res.json();
}
```

### Status
```javascript
async function getStatus(code) {
  const res = await fetch(`http://127.0.0.1:7777/api/status?code=${encodeURIComponent(code)}`, {
    cache: 'no-store'
  });

  return await res.json();
}
```

### Streams
```javascript
const stream = new EventSource(`http://127.0.0.1:7777/api/stream?code=${encodeURIComponent(code)}`);
const browserStream = new EventSource(`http://127.0.0.1:7777/api/browser-stream?code=${encodeURIComponent(code)}`);
```

---

## 12) O que o backend faz depois de receber o preset

Depois que o backend aceita `POST /api/preset`, ele:

- marca a execução como em andamento
- cria um `runId`
- chama o fluxo do browser com Puppeteer
- escreve o preset HTML temporário com os valores informados
- faz upload do arquivo para o roteador
- acompanha o processo por logs e screenshots
- emite eventos SSE para o front acompanhar em tempo real

Ou seja, o front **não precisa** saber executar a automação.  
Ele só precisa:
- enviar o JSON correto
- assinar os streams
- ler o status

---

## 13) Regras práticas para o APK conversar corretamente com o backend

### Se o front estiver dentro do mesmo backend
- carregue a interface com `?code=...`
- use `apiUrl()` para todas as chamadas
- use `EventSource` para SSE
- leia `/api/status` para sincronizar o estado

### Se o front estiver em outro app/origem
- garanta CORS completo no backend
- ou faça proxy
- ou sirva o front pela mesma origem do backend

### Se o backend estiver rodando no próprio Android
- `127.0.0.1` funciona apenas se o app e o backend estiverem no mesmo dispositivo
- se o front estiver em outro aparelho, troque a base URL para o IP da máquina que roda o backend

---

## 14) Resumo objetivo

### Input x envia para endpoint y

- `routerPassword` → `POST /api/preset` como `inputPassword`
- `emailPPPoEInput` → `POST /api/preset`
- `passwordPPPoEInput` → `POST /api/preset`
- `wifiName` → `POST /api/preset`
- `wifiPassword` → `POST /api/preset`
- botão `Preset Huawei` → `POST /api/preset`
- botão `Update ONU` → `POST /api/update-onu`
- painel de status → `GET /api/status`
- console ao vivo → `GET /api/stream`
- preview ao vivo do browser → `GET /api/browser-stream`

---

## 15) Checklist de implementação no front

- carregar o `code` na URL
- anexar o `code` em todas as requests
- validar os inputs antes do POST
- tratar `202`, `400`, `401` e `409`
- usar SSE para status e logs
- desabilitar botões enquanto houver execução
- atualizar o estado visual com `/api/status`

---

## 16) Conclusão

O front não fala com o backend “automaticamente”. Ele conversa com ele por:

- **fetch** para ações e status
- **EventSource** para tempo real
- **query `code` + cookie** para acesso protegido

Se o APK seguir esse contrato, a integração fica estável:

- o front coleta os dados
- o backend valida
- o backend executa a automação
- o front acompanha o progresso em tempo real

