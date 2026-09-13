import { loadConfig } from '../src/config.js';
import { genesisBlock } from '../src/ledger.js';
process.env.AUTO_LOCAL_SECRET='false';
const c=loadConfig();console.log(JSON.stringify(genesisBlock(c),null,2));
