import test from 'node:test';
import assert from 'node:assert/strict';
import { lanAddress, deviceLabel } from '../lib/net.js';

const iface = (address, family = 'IPv4') => [{ family, address, internal: false }];

test('优先物理网卡，跳过安卓模拟器虚拟网卡', () => {
  const interfaces = {
    'vEthernet (MEmuSwitch)': iface('172.21.208.1'),
    WLAN: iface('10.38.101.77'),
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  };
  assert.equal(lanAddress(interfaces), '10.38.101.77');
});

test('跳过 169.254 链路本地地址', () => {
  const interfaces = {
    'Ethernet 2': iface('169.254.245.30'),
    '以太网': iface('192.168.1.20'),
  };
  assert.equal(lanAddress(interfaces), '192.168.1.20');
});

test('只有虚拟网卡时仍可作为兜底', () => {
  const interfaces = { 'vEthernet (WSL)': iface('172.20.0.1') };
  assert.equal(lanAddress(interfaces), '172.20.0.1');
});

test('什么都没有就回环', () => {
  assert.equal(lanAddress({}), '127.0.0.1');
});

test('设备名可读', () => {
  assert.match(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120'), /Android/);
  assert.match(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari'), /iPhone/);
});
