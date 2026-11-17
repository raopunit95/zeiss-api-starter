// Experimental sender: route admission, authentication, payload and deduplication
// must be approved by the gateway/workflow owner before any real use.
//
// Two targets are supported:
//  1. Gateway (default): https://api-external.medibuddy.in/w/<route>, needs the global
//     gateway key AND an independent route auth header.
//  2. Direct n8n (LOCAL SYNTHETIC TESTING ONLY): https://n8n-public.medibuddy.in/webhook/<uuid>
//     (or /webhook-test/<uuid>). Must be opted into with allowDirectN8n=true. Route auth
//     header is optional here; if you set one it is sent.
const N8N_HOST = 'n8n-public.medibuddy.in';
const N8N_PATH = /^\/webhook(?:-test)?\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RESERVED = ['x-gateway-key','content-type','host','content-length','connection','cookie'];

export function createWebhookSender({url,gatewayKey,authHeader,authValue,allowDirectN8n=false,fetchFn=fetch}) {
  let endpoint; try { endpoint=new URL(url); } catch { throw Error('Invalid gateway configuration'); }
  if(endpoint.protocol!=='https:' || endpoint.port || endpoint.username || endpoint.password || endpoint.hash)throw Error('An approved HTTPS gateway route is required');
  const isGateway = endpoint.hostname==='api-external.medibuddy.in' && endpoint.pathname.startsWith('/w/') && endpoint.pathname!=='/w/';
  const isDirect = allowDirectN8n===true && endpoint.hostname===N8N_HOST && N8N_PATH.test(endpoint.pathname);
  if(!isGateway && !isDirect)throw Error('An approved HTTPS gateway route is required');

  const header=String(authHeader||'').trim();
  const headerOk = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header) && !RESERVED.includes(header.toLowerCase());
  const bad = v => /[\r\n]/.test(String(v));
  const headers={'Content-Type':'application/json'};
  if(isGateway){
    if(!headerOk)throw Error('Invalid route auth header');
    if(!gatewayKey || !authValue || bad(gatewayKey) || bad(authValue))throw Error('Gateway and route credentials required');
    headers['X-Gateway-Key']=gatewayKey; headers[header]=authValue;
  } else if(header || authValue){
    // Direct n8n: optional single static header (e.g. a Header Auth credential on the Webhook node).
    if(!headerOk || !authValue || bad(authValue))throw Error('Invalid route auth header');
    headers[header]=authValue;
  }

  return async(record,requestId)=>{
    if(typeof requestId!=='string'||!requestId.trim())throw Error('A request ID is required');
    const response=await fetchFn(endpoint,{method:'POST',headers,body:JSON.stringify({schema_version:'1',request_id:requestId,...record}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok){const e=Error('Acknowledgement not confirmed');e.status=response.status;throw e;}
    return {requestId,status:response.status}; // 2xx is only transport acknowledgement, not downstream processing.
  };
}
