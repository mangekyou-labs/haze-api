#!/usr/bin/env node
/**
 * Convert snarkjs BLS12-381 verification key JSON into Soroban-compatible hex format.
 *
 * Input:  snarkjs verification_key_*.json (decimal projective coordinates, z=1 for trusted-setup VKs)
 * Output: verification_key_soroban.json (hex-encoded uncompressed affine points)
 *
 * Usage: node scripts/vk-convert.js
 */

const fs = require('fs');
const path = require('path');

const BLS12_381_MODULUS_HEX =
  '1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab';

function bigIntToHex48(n) {
  const hex = BigInt(n).toString(16);
  const padded = hex.padStart(96, '0'); // 48 bytes = 96 hex chars
  if (padded.length > 96) throw new Error(`Value exceeds 48 bytes: ${n}`);
  return padded;
}

function bigIntToHex96(lo, hi) {
  // G2 x-coordinate: x = x_re + x_im * u, stored as [re, im] (each 48 bytes, little-reverse in memory)
  // But Soroban expects [lo, hi] in memory order (big-endian bytes): lo || hi
  return bigIntToHex48(lo) + bigIntToHex48(hi);
}

function g1ToHex(point) {
  // snarkjs G1: [x, y, z] — for trusted-setup VKs, z is always 1
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  const z = BigInt(point[2]);

  if (z !== 1n) {
    throw new Error(`G1 point z != 1 (projective reduction needed): z=${z}`);
  }

  // Validate point is on BLS12-381: y^2 = x^3 + 4 (mod p)
  const p = BigInt('0x' + BLS12_381_MODULUS_HEX);
  const y2 = (y * y) % p;
  const x3 = (x * x * x) % p;
  const rhs = (x3 + 4n) % p;
  if (y2 !== rhs) {
    throw new Error(`G1 point not on curve: x=${x}, y=${y}`);
  }

  // Check y < p (valid field element)
  if (y >= p) throw new Error(`G1 y-coordinate out of range: y=${y}`);
  if (x >= p) throw new Error(`G1 x-coordinate out of range: x=${x}`);

  // Uncompressed: [0x04, x(48 bytes), y(48 bytes)] = 97 bytes
  // Soroban G1Affine::from_bytes expects 96 bytes (no prefix)
  return '0x' + bigIntToHex48(x) + bigIntToHex48(y);
}

function g2ToHex(point) {
  // snarkjs G2: [[x_re, x_im], [y_re, y_im], [z_re, z_im]]
  // For trusted-setup VKs, z = [1, 0]
  const zRe = BigInt(point[2][0]);
  const zIm = BigInt(point[2][1]);

  if (zRe !== 1n || zIm !== 0n) {
    throw new Error(`G2 point z != [1, 0] (projective reduction needed): z=[${zRe}, ${zIm}]`);
  }

  const xRe = BigInt(point[0][0]);
  const xIm = BigInt(point[0][1]);
  const yRe = BigInt(point[1][0]);
  const yIm = BigInt(point[1][1]);

  const p = BigInt('0x' + BLS12_381_MODULUS_HEX);
  if (xRe >= p || xIm >= p || yRe >= p || yIm >= p) {
    throw new Error('G2 coordinate out of range');
  }

  // Soroban G2Affine: 192 bytes uncompressed
  // Memory layout: be_bytes(c1) || be_bytes(c0) for each Fp2 coordinate
  // (imaginary part first, then real part — matches arkworks/standard BLS12-381)
  // Full layout: x_im(48) || x_re(48) || y_im(48) || y_re(48) = 192 bytes
  return '0x' + bigIntToHex48(xIm) + bigIntToHex48(xRe) + bigIntToHex48(yIm) + bigIntToHex48(yRe);
}

function convertVk(vkPath) {
  const vk = JSON.parse(fs.readFileSync(vkPath, 'utf-8'));

  if (vk.curve !== 'bls12381') {
    throw new Error(`Expected BLS12-381 VK, got ${vk.curve}`);
  }

  return {
    alpha: g1ToHex(vk.vk_alpha_1),
    beta: g2ToHex(vk.vk_beta_2),
    gamma: g2ToHex(vk.vk_gamma_2),
    delta: g2ToHex(vk.vk_delta_2),
    ic: vk.IC.map((p, i) => {
      try {
        return g1ToHex(p);
      } catch (e) {
        throw new Error(`IC[${i}] conversion failed: ${e.message}`);
      }
    }),
    nPublic: vk.nPublic,
  };
}

if (require.main === module) {
  const circuitsDir = path.join(__dirname, '..', 'circuits');
  const vks = ['deposit', 'rln', 'slash', 'membership_removal'];

  for (const name of vks) {
    const inputPath = path.join(circuitsDir, `verification_key_${name}.json`);
    const outputPath = path.join(circuitsDir, `verification_key_${name}_soroban.json`);

    if (!fs.existsSync(inputPath)) {
      console.warn(`⚠ ${inputPath} not found, skipping`);
      continue;
    }

    try {
      const result = convertVk(inputPath);
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`✓ ${name}: ${result.ic.length} IC points → ${outputPath}`);
      console.log(`  alpha: ${result.alpha.slice(0, 18)}…`);
      console.log(`  beta:  ${result.beta.slice(0, 18)}…`);
      console.log(`  gamma: ${result.gamma.slice(0, 18)}…`);
      console.log(`  delta: ${result.delta.slice(0, 18)}…`);
    } catch (e) {
      console.error(`✗ ${name}: ${e.message}`);
      process.exit(1);
    }
  }

  console.log('\nDone. Use these hex values in Rust test fixtures with Bls12381G1Affine::from_bytes.');
}

module.exports = { convertVk, g1ToHex, g2ToHex };
