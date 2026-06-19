// test_persistence_integrity.ts -- automated test for serialization and compression
// Phase 4: Verification

import { stripDefaults } from '../app/lib/document';
import { compressDocument, decompressDocument } from './redis';

// Mock Fabric object with default values
const mockObject = {
  type: 'rect',
  left: 100,
  top: 150,
  width: 200,
  height: 200,
  fill: '#ff0000',
  // Default values to be stripped
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  opacity: 1,
  visible: true,
  originX: 'left',
  originY: 'top',
  // Custom values (should not be stripped)
  id: 'rect_123',
  subtype: 'rectangle',
};

console.log('--- Phase 4: Persistence Integrity Test ---');
console.log('Original Object keys count:', Object.keys(mockObject).length);

// 1. Test defaults stripping
const stripped = stripDefaults(mockObject);
console.log('Stripped Object keys count:', Object.keys(stripped).length);
console.log('Stripped Object JSON:', JSON.stringify(stripped));

// Verification
const expectedKeptKeys = ['type', 'left', 'top', 'width', 'height', 'fill', 'id', 'subtype'];
const actualKeys = Object.keys(stripped);
const hasAllKept = expectedKeptKeys.every((k) => actualKeys.includes(k));
const hasStrippedAnyDefault = !actualKeys.includes('scaleX') && !actualKeys.includes('angle');

if (hasAllKept && hasStrippedAnyDefault) {
  console.log('✅ stripDefaults passed verification.');
} else {
  console.error('❌ stripDefaults failed verification!');
  process.exit(1);
}

// 2. Test compression & decompression
const mockDoc = {
  v: 1,
  boardId: 'test-board',
  meta: {
    created: Date.now(),
    modified: Date.now(),
    objectCount: 1,
  },
  bounds: { minX: 100, minY: 150, maxX: 300, maxY: 350 },
  objects: [stripped],
};

const docString = JSON.stringify(mockDoc);
console.log(`\nOriginal Document JSON length: ${docString.length} chars`);

const compressed = compressDocument(docString);
console.log(`Compressed (Gzipped + Base64) size: ${compressed.length} bytes`);
console.log(
  `Compression ratio: ${((1 - compressed.length / docString.length) * 100).toFixed(2)}% reduction`
);

const decompressed = decompressDocument(compressed);
console.log(`Decompressed length: ${decompressed.length} chars`);

if (decompressed === docString) {
  console.log('✅ Compression/Decompression is lossless and verified.');
} else {
  console.error('❌ Decompressed string does NOT match original!');
  process.exit(1);
}

console.log('\n🎉 Persistence integrity test PASSED successfully!');
