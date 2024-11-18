/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { onTestFinished } from "vitest";

import { Client, Server } from "~/index.js";
import { LayeredCache } from "~/LayeredCache.js";
import type { Json } from "~/lib/Json.js";
import { makePipe } from "~/lib/Pipe.js";
import type { ClientMsg, Mutations, ServerMsg, Socket } from "~/types.js";

export function fmt(
  /* eslint-disable @typescript-eslint/no-explicit-any */
  value: Client<any> | Server<any> | LayeredCache
  /* eslint-enable @typescript-eslint/no-explicit-any */
): Record<string, Json> {
  if (value instanceof LayeredCache) {
    return Object.fromEntries(value);
  } else {
    return value.data;
  }
}

export function size(cache: LayeredCache): number {
  return Array.from(cache.keys()).length;
}

function connectClientAndServer(client: Client<any>, server: Server<any>) {
  // Build two two-way sockets, interconnect them, and hand the client and
  // the server one end each.
  const c2sPipe = makePipe<ClientMsg>();
  const s2cPipe = makePipe<ServerMsg>();

  // Disable auto-sync! No messages will get delivered until explicitly
  // requested so by calling sync()
  c2sPipe.setManual();
  s2cPipe.setManual();

  const clientSocket: Socket<ClientMsg, ServerMsg> = {
    send: (data) => c2sPipe.send(data),
    recv: s2cPipe.output,
  };
  const serverSocket: Socket<ServerMsg, ClientMsg> = {
    send: (data) => s2cPipe.send(data),
    recv: c2sPipe.output,
  };

  const disconnect1 = server.connect(serverSocket);
  const disconnect2 = client.connect(clientSocket);

  async function syncClient() {
    await c2sPipe.flush();
  }

  async function syncServer() {
    await s2cPipe.flush();
  }

  async function disconnect() {
    await syncClient();
    await syncServer();
    disconnect1();
    disconnect2();
  }

  // Ensures all messages between client and server get exchanged, and waits
  // until that has happened
  async function sync() {
    await syncClient();
    await syncServer();
  }

  onTestFinished(() => disconnect());

  return { syncClient, syncServer, sync, disconnect };
}

/**
 * Given a set of mutators, will create a Client and Server instance, connect
 * them, and return those.
 *
 * When the test is over, it will disconnect them and clean everything up.
 *
 * This is a SYMMETRIC test, because the client and the server use the same
 * mutators implementation.
 */
export function clientServerSetup<M extends Mutations>(mutations: M) {
  const client = new Client(mutations);
  const server = new Server(mutations);

  const { sync, disconnect } = connectClientAndServer(client, server);

  return { client, server, sync, disconnect };
}

export function twoClientSetup<M extends Mutations>(mutations: M) {
  const { server, clients, sync } = multiClientServerSetup(2, mutations);
  const client1 = clients[0]!.client;
  const client2 = clients[1]!.client;
  return { client1, client2, server, sync };
}

type ClientControl<M extends Mutations> = {
  client: Client<M>;
  syncServer(): Promise<void>;
  syncClient(): Promise<void>;
  disconnect(): Promise<void>;
};

export function multiClientServerSetup<M extends Mutations>(
  numClients: number,
  mutations: M
) {
  const server = new Server(mutations);

  const clients: ClientControl<M>[] = [];

  for (let i = 1; i <= numClients; i++) {
    const client = new Client(mutations);
    const { syncServer, syncClient, disconnect } = connectClientAndServer(
      client,
      server
    );
    clients.push({ client, syncServer, syncClient, disconnect });
  }

  /**
   * Deliver all queued up messages in a specific pipe (aka flush that pipe),
   * and wait for all those messages to be delivered/handled. Pipes are
   * unidirectional. The following calls are possible:
   *
   * - await sync(client1)          Flushes all queued messages from client 1 to the server.
   * - await sync(server, client1)  Flushes all queued messages from the server to client 1.
   * - await sync(server)           Flushes all queued messages from the server to all
   *                                connected clients.
   * - await sync()                 Flushes all pipes, delivering all queued messages.
   */
  async function sync(): Promise<void>; // (1)
  async function sync(src: Client<M>): Promise<void>; // (2)
  async function sync(src: Server<M>): Promise<void>; // (3)
  async function sync(src: Server<M>, tgt: Client<M>): Promise<void>; // (4)
  async function sync(src?: Client<M> | Server<M>, tgt?: Client<M>) {
    // (1)
    if (!src && !tgt) {
      for (const ctl of clients) {
        await ctl.syncClient();
        await ctl.syncServer();
      }
      return;
    }
    src = src!; // We now know that src is set

    // (4)
    if (src && tgt) {
      for (const ctl of clients) {
        if (tgt === ctl.client) {
          await ctl.syncServer();
        }
      }
      return;
    }

    // (2) or (3)
    for (const ctl of clients) {
      if (src === server) {
        await ctl.syncServer();
      } else if (src === ctl.client) {
        await ctl.syncClient();
      }
    }
  }

  return { clients, server, sync };
}

/**
 * Given a set of mutators, will create two Clients and Server instance,
 * connect them all, and return those.
 *
 * When the test is over, it will disconnect them all and clean everything up.
 *
 * This is a SYMMETRIC test, because the clients and the server all use the
 * same mutators implementation.
 */
// export function twoClientSetup<M extends Mutations>(mutations: M) {
//   const client1 = new Client(mutations);
//   const client2 = new Client(mutations);
//   const server = new Server(mutations);
//
//   // Build two two-way sockets, interconnect them, and hand the client and
//   // the server one end each.
//   const c2sPipe = makePipe<ClientMsg>();
//   const s2cPipe = makePipe<ServerMsg>();
//
//   const clientSocket: Socket<ClientMsg, ServerMsg> = {
//     send: (data) => c2sPipe.send(data),
//     recv: s2cPipe.output,
//   };
//   const serverSocket: Socket<ServerMsg, ClientMsg> = {
//     send: (data) => s2cPipe.send(data),
//     recv: c2sPipe.output,
//   };
//
//   const disconnect1 = server.connect(serverSocket);
//   onTestFinished(() => disconnect1());
//
//   const disconnect2 = client.connect(clientSocket);
//   onTestFinished(() => disconnect2());
//
//   // Ensures all messages between client and server get exchanged, and waits
//   // until that has happened
//   async function sync() {
//     await c2sPipe.flush();
//     await s2cPipe.flush();
//   }
//
//   onTestFinished(() => sync());
//
//   return {
//     client,
//     server,
//     sync,
//   };
// }
