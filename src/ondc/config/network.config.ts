import { ondcEnv } from '~/config/ondc.config';

const PREPROD_GATEWAY = 'https://preprod.gateway.ondc.org';
const PROD_GATEWAY = 'https://prod.gateway.ondc.org';

const isProd = ondcEnv.environment === 'prod';

export const ondcNetwork = {
  gateway: isProd ? PROD_GATEWAY : PREPROD_GATEWAY,
  registryLookup: ondcEnv.registryLookupUrl,
  observability: ondcEnv.observabilityUrl,

  // Our BPP callback base (buyer apps will POST to these)
  bppBaseUri: ondcEnv.baseUri,

  // Beckn endpoints we expose
  endpoints: {
    search: `${ondcEnv.baseUri}/search`,
    select: `${ondcEnv.baseUri}/select`,
    init: `${ondcEnv.baseUri}/init`,
    confirm: `${ondcEnv.baseUri}/confirm`,
    status: `${ondcEnv.baseUri}/status`,
    track: `${ondcEnv.baseUri}/track`,
    cancel: `${ondcEnv.baseUri}/cancel`,
    update: `${ondcEnv.baseUri}/update`,
    issue: `${ondcEnv.baseUri}/issue`,
    issueStatus: `${ondcEnv.baseUri}/issue_status`,
    onReceiverRecon: `${ondcEnv.baseUri}/on_receiver_recon`,
  },

  // Timeouts for outgoing calls (ms)
  timeouts: {
    registry: 5_000,
    callback: 10_000,
    observability: 1_500,
  },
} as const;
