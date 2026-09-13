import assert from 'node:assert/strict';
import { selectModelForHardware } from '../src/runtime-bootstrap.js';

const cpuSmall={cpuCores:2,ramMiB:8192,gpuCount:0,totalVramMiB:0};
const cpuMid={cpuCores:12,ramMiB:32768,gpuCount:0,totalVramMiB:0};
const gpu8={cpuCores:8,ramMiB:32768,gpuCount:1,totalVramMiB:8192};
const gpu24={cpuCores:16,ramMiB:65536,gpuCount:1,totalVramMiB:24576};
assert.equal(selectModelForHardware(cpuSmall).selected,'qwen3:1.7b');
assert.equal(selectModelForHardware(cpuMid).selected,'qwen3:8b');
assert.equal(selectModelForHardware(gpu8).selected,'qwen3:4b');
assert.equal(selectModelForHardware(gpu24).selected,'qwen3:14b');
assert.equal(selectModelForHardware(gpu24,{profile:'fast'}).selected,'qwen3:8b');
assert.equal(selectModelForHardware(gpu24,{profile:'quality'}).selected,'qwen3:30b');
assert.equal(selectModelForHardware(gpu24,{maxModel:'qwen3:8b'}).selected,'qwen3:8b');
assert.equal(selectModelForHardware(gpu24,{autoModel:false,explicitModel:'qwen3:4b'}).selected,'qwen3:4b');
console.log('INDEX BOOTSTRAP V0.7.3 OK');
