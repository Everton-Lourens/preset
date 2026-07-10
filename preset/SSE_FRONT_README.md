# Integração em tempo real com SSE

## Arquitetura

- `app/(tabs)/index.tsx`
  - orquestra a tela
  - envia `POST /api/preset` e `POST /api/update-onu`
  - consulta `GET /health`
  - solicita sincronização manual de `GET /api/status`

- `hooks/use-backend-realtime.ts`
  - abre as duas conexões SSE
  - trata `log`, `status`, `browser-session` e `browser-frame`
  - reconecta automaticamente
  - sincroniza com `GET /api/status` ao reconectar

- `components/live-console.tsx`
  - renderiza o console ao vivo

- `components/browser-preview.tsx`
  - renderiza o frame ao vivo
  - mostra o passo atual com base em `lastFrameLabel` e `browserView.label`

## Eventos SSE

### `GET /api/stream?code=...`

- `log`
  - tratado em `hooks/use-backend-realtime.ts`
  - empilha no console visual

- `status`
  - tratado em `hooks/use-backend-realtime.ts`
  - atualiza o estado geral da tela

### `GET /api/browser-stream?code=...`

- `browser-session`
  - tratado em `hooks/use-backend-realtime.ts`
  - atualiza o painel de execução ao vivo

- `browser-frame`
  - tratado em `hooks/use-backend-realtime.ts`
  - monta a URI:
    - `data:${mimeType};base64,${image}`
  - atualiza o preview em tempo real

## Exemplo de integração

```ts
const stream = createEventSource(`${base}/api/stream?code=${code}`);
stream.addEventListener('log', (event) => {
  const payload = JSON.parse(event.data);
  console.log(payload.message);
});

const browserStream = createEventSource(`${base}/api/browser-stream?code=${code}`);
browserStream.addEventListener('browser-frame', (event) => {
  const payload = JSON.parse(event.data);
  const uri = `data:${payload.frame.mimeType};base64,${payload.frame.image}`;
  setPreview(uri);
});
```

## Reconexão

Ao cair a conexão:

1. fecha as conexões atuais
2. espera um backoff curto
3. reabre os dois streams
4. chama `GET /api/status`
5. sincroniza a tela com o estado atual

## Console ao vivo

Cada evento `log` vira uma linha nova no console.
O componente `LiveConsole` faz scroll automático para o final.

## Frame ao vivo

Cada `browser-frame` substitui a imagem atual.
O componente `BrowserPreview` atualiza o `<Image />` com a nova data URI.

## Correção da senha Wi-Fi

A validação aceita:

- `8` a `63` caracteres ASCII imprimíveis
- ou `64` caracteres hexadecimais

Isso corrige o bloqueio indevido na borda mínima de 8 caracteres.
