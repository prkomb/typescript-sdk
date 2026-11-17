import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/core-internal';
import { isJSONRPCRequest } from '@modelcontextprotocol/core-internal';
import { describe, expect, test } from 'vitest';

import { Client } from '../../src/client/client';

// Answers `initialize` with the given version; close() fires onclose a tick later, like a child process exiting.
class ExitingProcessTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    closeEvents = 0;

    constructor(private readonly _protocolVersion: string) {}

    async start(): Promise<void> {}

    async send(message: JSONRPCMessage): Promise<void> {
        if (!isJSONRPCRequest(message) || message.method !== 'initialize') return;
        queueMicrotask(() => {
            this.onmessage?.({
                jsonrpc: '2.0',
                id: message.id,
                result: { protocolVersion: this._protocolVersion, capabilities: {}, serverInfo: { name: 's', version: '0' } }
            });
        });
    }

    async close(): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 0));
        this.closeEvents++;
        this.onclose?.();
    }
}

describe('legacy handshake: initialize result with an unsupported protocol version', () => {
    test('connect() waits for close() before rejecting', async () => {
        const transport = new ExitingProcessTransport('1999-01-01');
        const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'legacy' } });

        await expect(client.connect(transport)).rejects.toThrow(/protocol version is not supported/);

        expect(transport.closeEvents).toBe(1);
        expect(client.transport).toBeUndefined();
    });

    test('a connect() retried right after the rejection keeps its new transport', async () => {
        const failed = new ExitingProcessTransport('1999-01-01');
        const retried = new ExitingProcessTransport('2025-11-25');
        const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'legacy' } });

        await expect(client.connect(failed)).rejects.toThrow(/protocol version is not supported/);
        await client.connect(retried);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(failed.closeEvents).toBe(1);
        expect(client.transport).toBe(retried);
        expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');

        await client.close();
    });

    test('a close that fails does not replace the initialize error', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandled);
        try {
            const transport = new ExitingProcessTransport('1999-01-01');
            transport.close = async () => {
                throw new Error('close failed');
            };
            const client = new Client({ name: 'c', version: '0' }, { versionNegotiation: { mode: 'legacy' } });

            await expect(client.connect(transport)).rejects.toThrow(/protocol version is not supported/);

            // Let any stray rejection surface before asserting none did.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });
});
