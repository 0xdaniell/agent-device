import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  closeLoopbackServer,
  createTestHostEnvironment,
  listenOnLoopback,
  mkdtempForTestSync,
  skipWhenLoopbackUnavailable,
} from '@agent-device/test-kit';
import { materializeRemoteArtifacts, prepareRemoteRequestArtifacts } from '../daemon-artifacts.ts';

const signal = new AbortController().signal;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

test('a remote batch records where each screenshot step should land on the caller', async () => {
  const prepared = await prepareRemoteRequestArtifacts(
    {
      command: 'batch',
      session: 'capture',
      positionals: [],
      flags: {
        batchSteps: [
          { command: 'press', positionals: ['200', '650'] },
          { command: ' SCREENSHOT ', positionals: ['look.png'] },
          { command: 'screenshot', input: { path: '/abs/second.png' } },
          { command: 'screenshot' },
        ],
      },
      meta: { cwd: '/client' },
    },
    { baseUrl: 'http://remote.example.test/agent-device', token: 'secret' },
    signal,
    createTestHostEnvironment(),
  );
  const paths = prepared.clientArtifactPaths ?? {};
  expect(paths['batch:1:path']).toBeUndefined();
  expect(paths['batch:2:path']).toBe('/client/look.png');
  expect(paths['batch:3:path']).toBe('/abs/second.png');
  expect(paths['batch:4:path']).toMatch(/^\/client\/screenshot-\d+-4\.png$/);
});

test('a local batch plans no client downloads', async () => {
  const prepared = await prepareRemoteRequestArtifacts(
    {
      command: 'batch',
      session: 'capture',
      positionals: [],
      flags: { batchSteps: [{ command: 'screenshot', positionals: ['look.png'] }] },
      meta: { cwd: '/client' },
    },
    { token: 'secret' },
    signal,
    createTestHostEnvironment(),
  );
  expect(prepared.clientArtifactPaths).toBeUndefined();
});

test('a remote batch downloads each step screenshot to the path the caller named', async (t) => {
  if (await skipWhenLoopbackUnavailable(t, 'remote batch screenshot download coverage')) return;
  const root = mkdtempForTestSync('agent-device-remote-batch-artifacts-');
  const served: string[] = [];
  const server = http.createServer((request, response) => {
    served.push(request.url ?? '');
    response.setHeader('content-type', 'image/png');
    response.end(PNG);
  });
  try {
    const port = await listenOnLoopback(server);
    const local = path.join(root, 'look.png');
    const remotePath = '/var/folders/x/agent-device-screenshot-1/screenshot.png';
    const materialized = await materializeRemoteArtifacts(
      { baseUrl: `http://127.0.0.1:${port}`, token: 'daemon-token' },
      {
        command: 'batch',
        session: 'capture',
        positionals: [],
        token: 'daemon-token',
        meta: { cwd: root, clientArtifactPaths: { 'batch:2:path': local } },
      },
      {
        ok: true,
        data: {
          total: 2,
          executed: 2,
          totalDurationMs: 10,
          results: [
            {
              step: 1,
              command: 'press',
              ok: true,
              data: { message: 'Tapped (200, 650)' },
              durationMs: 5,
            },
            {
              step: 2,
              command: 'screenshot',
              ok: true,
              data: {
                path: remotePath,
                message: `Saved screenshot: ${remotePath}`,
                artifacts: [{ field: 'path', artifactType: 'screenshot', artifactId: 'shot-2' }],
              },
              durationMs: 5,
            },
          ],
        },
      },
      createTestHostEnvironment(),
    );
    expect(served).toEqual(['/artifacts/shot-2']);
    expect(fs.readFileSync(local)).toEqual(PNG);
    if (!materialized.ok) throw new Error('materialized response must stay ok');
    const results = materialized.data?.results as Array<{ data: Record<string, unknown> }>;
    expect(results[0]?.data).toEqual({ message: 'Tapped (200, 650)' });
    expect(results[1]?.data.path).toBe(local);
    expect(results[1]?.data.message).toBe(`Saved screenshot: ${local}`);
    expect(results[1]?.data.artifacts).toEqual([
      { field: 'path', artifactType: 'screenshot', artifactId: 'shot-2', localPath: local },
    ]);
  } finally {
    await closeLoopbackServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
