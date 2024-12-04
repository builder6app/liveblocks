import { expect, onTestFinished, test, vi } from "vitest";

import { Client } from "~/Client.js";

import {
  del,
  dupe,
  fail,
  put,
  putAndFail,
  putAndInc,
  setLiveObject,
} from "../mutations.config.js";
import { twoClientsSetup } from "../utils.js";

test("set string", () => {
  const client = new Client({ put });
  expect(client.data).toEqual({});

  client.mutate.put("a", "a");

  expect(client.data).toEqual({ root: { a: "a" } });
});

test("set number", () => {
  const client = new Client({ put });
  expect(client.data).toEqual({});

  client.mutate.put("a", 0);

  expect(client.data).toEqual({ root: { a: 0 } });
});

test("set object", () => {
  const client = new Client({ put });
  expect(client.data).toEqual({});

  client.mutate.put("a", { foo: "bar" });

  expect(client.data).toEqual({ root: { a: { foo: "bar" } } });
});

test("set LiveObject", () => {
  const client = new Client({ setLiveObject });

  expect(client.data).toEqual({});

  client.mutate.setLiveObject("child", "foo", "bar");
  client.mutate.setLiveObject("child2", "a", 1);

  expect(client.data).toEqual({
    root: { child: { $ref: "O0:1" }, child2: { $ref: "O1:2" } },
    "O0:1": { foo: "bar" },
    "O1:2": { a: 1 },
  });
});

// XXX Make pass!
test.fails("using .toImmutable() should return the same value", () => {
  const client = new Client({ setLiveObject });
  client.mutate.setLiveObject("a", "foo", "bar");
  expect(client.root).toEqual({ a: { foo: "bar" } });
});

test("using .get() should always return the same Live instance", () => {
  const client = new Client({
    setLiveObject,

    // We can inline a mutation in this test, because we're not sending
    // anything to a server here anyway
    customTest: (root) => {
      const obj1 = root.get("a");
      const obj2 = root.get("a");

      // Should be the same object!
      if (obj1 !== obj2) {
        throw new Error('Expected .get("a") to return a stable result');
      }
    },
  });

  client.mutate.setLiveObject("a", "foo", "bar");
  client.mutate.customTest();

  expect(client.data).toEqual({
    root: { a: { $ref: "O0:1" } },
    "O0:1": { foo: "bar" },
  });
});

test("attaching the same LiveObject under multiple roots fails", () => {
  const client = new Client({ dupe, setLiveObject });

  client.mutate.setLiveObject("a", "foo", "bar");
  expect(() => client.mutate.dupe("a", "b")).toThrow(
    "LiveObject already attached to this pool as O0:1"
  );

  expect(client.data).toEqual({
    root: { a: { $ref: "O0:1" } },
    "O0:1": { foo: "bar" },
  });
});

// test("set LiveList", () => {
//   const { clientA, assertStorage } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       setLiveList,
//     },
//   });
//
//   assertStorage({});
//
//   clientA.mutate.setLiveList("items", "foo");
//
//   assertStorage({ items: ["foo"] });
// });
//
// test("set LiveObject in LiveList", () => {
//   const { clientA, assertStorage } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       foo: ({
//         root,
//       }: MutationContext<{
//         items?: LiveList<LiveObject<{ key: number }>>;
//       }>) => {
//         const liveObject = new LiveObject({ key: 0 });
//         const liveList = new LiveList([liveObject]);
//
//         root.set("items", liveList);
//       },
//     },
//   });
//
//   assertStorage({});
//
//   clientA.mutate.foo();
//
//   assertStorage({ items: [{ key: 0 }] });
// });
//
// test("delete item in LiveList", () => {
//   const { clientA, assertStorage } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       setLiveList,
//       deleteItem: (
//         { root }: MutationContext<Record<string, LiveList<string>>>,
//         key: string,
//         index: number
//       ) => {
//         const list = root.get(key);
//
//         if (list === undefined) {
//           throw new Error("Missing list");
//         }
//
//         list.delete(index);
//       },
//     },
//   });
//
//   assertStorage({});
//
//   clientA.mutate.setLiveList("items", "foo");
//
//   assertStorage({ items: ["foo"] });
//
//   clientA.mutate.deleteItem("items", 0);
//
//   assertStorage({ items: [] });
// });
//

test("del", () => {
  const client = new Client({ put, del });
  expect(client.data).toEqual({});

  client.mutate.put("a", "a");
  expect(client.data).toEqual({ root: { a: "a" } });

  client.mutate.del("a");
  expect(client.data).toEqual({});

  client.mutate.del("a"); // Deleting again is a no-op
  expect(client.data).toEqual({});
});

// test("conflict test", () => {
//   const { clientA, clientB, assertStorage, server } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       set,
//     },
//   });
//
//   assertStorage({});
//
//   clientA.disconnect();
//   clientB.disconnect();
//
//   clientA.mutate.set("a", "a");
//   clientB.mutate.set("a", "b");
//
//   expect(clientA.toImmutable()).toStrictEqual({ a: "a" });
//   expect(clientB.toImmutable()).toStrictEqual({ a: "b" });
//   expect(server.toImmutable()).toStrictEqual({});
//
//   clientA.reconnect();
//
//   expect(clientA.toImmutable()).toStrictEqual({ a: "a" });
//   expect(clientB.toImmutable()).toStrictEqual({ a: "b" });
//   expect(server.toImmutable()).toStrictEqual({ a: "a" });
//
//   clientB.reconnect();
//
//   assertStorage({ A: "B" });
// });
//
// // If server mutation behavior is different from client, server should be the source of truth
// test("server mutation mismatch", () => {
//   const { clientA, clientB, assertStorage, server } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       foo: ({ root }: MutationContext<Record<string, string>>) =>
//         root.set("A", "foo"),
//     },
//     serverMutations: {
//       foo: ({ root }: MutationContext<Record<string, string>>) =>
//         root.set("A", "bar"),
//     },
//   });
//
//   clientA.disconnect();
//
//   clientA.mutate.foo();
//
//   expect(clientA.toImmutable()).toStrictEqual({ A: "foo" });
//   expect(clientB.toImmutable()).toStrictEqual({});
//   expect(server.toImmutable()).toStrictEqual({});
//
//   clientA.reconnect();
//
//   assertStorage({ A: "bar" });
// });
//
// // If server mutation is missing, server should ignore it and client should rollback
// test("missing server mutation", () => {
//   const { clientA, clientB, assertStorage, server } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       foo: ({ root }: MutationContext<Record<string, string>>) =>
//         root.set("A", "foo"),
//     },
//     serverMutations: {},
//   });
//
//   clientA.disconnect();
//
//   clientA.mutate.foo();
//
//   expect(clientA.toImmutable()).toStrictEqual({ A: "foo" });
//   expect(clientB.toImmutable()).toStrictEqual({});
//   expect(server.toImmutable()).toStrictEqual({});
//
//   clientA.reconnect();
//
//   assertStorage({});
// });
//
// test("error in server mutation should be caught and client should rollback", () => {
//   const { clientA, clientB, assertStorage, server } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       foo: ({ root }: MutationContext<Record<string, string>>) =>
//         root.set("A", "foo"),
//     },
//     serverMutations: {
//       foo: ({}: MutationContext<Record<string, string>>) => {
//         throw new Error("FAIL");
//       },
//     },
//   });
//
//   clientA.disconnect();
//
//   clientA.mutate.foo();
//
//   expect(clientA.toImmutable()).toStrictEqual({ A: "foo" });
//   expect(clientB.toImmutable()).toStrictEqual({});
//   expect(server.toImmutable()).toStrictEqual({});
//
//   clientA.reconnect();
//
//   assertStorage({});
// });
//
// test("server mutation failure should rollback transaction", () => {
//   const { clientA, clientB, server } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       set,
//     },
//     serverMutations: { set: putAndFail },
//   });
//
//   clientA.disconnect();
//
//   clientA.mutate.set("A", "A");
//
//   expect(clientA.toImmutable()).toStrictEqual({ A: "A" });
//
//   clientA.reconnect();
//
//   expect(clientA.toImmutable()).toStrictEqual({});
//   expect(clientB.toImmutable()).toStrictEqual({});
//   expect(server.toImmutable()).toStrictEqual({});
// });
//
// test("Reconnect after multiple local operations", () => {
//   const { clientA, assertStorage } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       createItems: ({
//         root,
//       }: MutationContext<{ items?: LiveList<string> }>) => {
//         root.set("items", new LiveList([]));
//       },
//       push: (
//         { root }: MutationContext<{ items?: LiveList<string> }>,
//         item: string
//       ) => {
//         root.get("items")?.push(item);
//       },
//     },
//   });
//
//   clientA.disconnect();
//
//   clientA.mutate.createItems();
//   clientA.mutate.push("A");
//   clientA.mutate.push("B");
//
//   expect(clientA.toImmutable()).toStrictEqual({ items: ["A", "B"] });
//
//   clientA.reconnect();
//
//   assertStorage({ items: ["A", "B"] });
// });

test("get value during transaction should come from transaction cache", () => {
  const client = new Client({ putAndInc });

  client.mutate.putAndInc("A", 0);
  expect(client.data).toEqual({ root: { A: 1 } });
});

test("when client mutation errors it should rollback transaction", () => {
  const fn = vi.fn();

  const client = new Client({ putAndFail });
  const unsub = client.events.onChange.subscribe(fn);
  onTestFinished(unsub);

  try {
    client.mutate.putAndFail("A", "A");
  } catch {}
  expect(client.data).toEqual({});
  expect(fn).not.toHaveBeenCalled();
});

test("errors in client mutations should be thrown, not caught", () => {
  const fn = vi.fn();

  const client = new Client({ fail });
  const unsub = client.events.onChange.subscribe(fn);
  onTestFinished(unsub);

  try {
    client.mutate.fail();
  } catch {}

  expect(client.data).toStrictEqual({});
  expect(fn).not.toHaveBeenCalled();
});

test("errors thrown by deferred client mutations (ie after rebase) should not be thrown but emitted as error events", async () => {
  const errorCallback = vi.fn();

  const { client1, client2, sync } = await twoClientsSetup({ put, dupe, del });

  const unsub = client1.events.onMutationError.subscribe(errorCallback);
  onTestFinished(unsub);

  // Initial state setup
  client1.mutate.put("a", 1);
  await sync();

  // Create a conflict:
  // - Client 2 will remove the 'a' key first
  // - Client 1 will try to dupe the 'a' key. This will work locally (so it
  //   won't throw initially), but once client 1 will receive the changes from
  //   client 2, it will throw locally because it can no longer rebase the
  //   'dupe' mutation locally.
  client2.mutate.del("a");
  await sync(client2);

  client1.mutate.dupe("a", "b");
  await sync(client1);

  expect(client1.data).toEqual({ root: { a: 1, b: 1 } });
  expect(client2.data).toEqual({});

  await sync();

  // Assert that an error is thrown as an event
  expect(errorCallback).toHaveBeenCalledWith(
    expect.objectContaining({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      message: expect.stringMatching("No such key 'a'"),
    })
  );

  // Assert that there was a "did change" event here.
  // From the client's local perspective, both keys "a" and "b" got removed.

  // And that the data itself was rolled back
  expect(client1.data).toEqual({});
  expect(client2.data).toEqual({});
});

test.skip("onChange notifications", async () => {
  const fn = vi.fn();

  const { client1, client2, sync } = await twoClientsSetup({ put, dupe });
  const unsub = client1.events.onChange.subscribe(fn);
  onTestFinished(unsub);

  // Initial state setup
  client2.mutate.put("a", 42);
  await sync();

  // XXX fn() should have been called with Delta: [[], ['a', 42]] (remote)

  client1.mutate.dupe("a", "b");
  // client2.mutate.clear();

  // XXX fn() should have been called with Delta: [[], ['b', 42]] (local)

  await sync();

  // XXX fn() should have been called with Delta: [['a', 'b'], []] (remote)

  expect(client1.data).toEqual({});
  expect(client2.data).toEqual({});
});

/// test("nested LiveObject", () => {
///   const client = new ClientStorage({
///     mutations: {
///       setLiveObject,
///     },
///     storage: {},
///     actor: 0,
///     onLocalMutation: () => {},
///   });
///
///   client.mutate.setLiveObject("child", "foo", "bar");
///
///   expect(client.toImmutable()).toStrictEqual({
///     child: {
///       foo: "bar",
///     },
///   });
/// });

/// // Testing internals until we implement LiveStructure reference recycling
/// test("mutation failure should clear nodes created during transaction", () => {
///   const client = new Client({
///     mutations: {
///       raiseAfterSetLiveObject,
///     },
///     storage: {},
///     actor: 0,
///     onLocalMutation: () => {},
///   });
///
///   client.mutate.raiseAfterSetLiveObject("child", "foo", "bar");
///
///   expect(client.toImmutable()).toStrictEqual({});
///
///   client.__internals.getTransactionNodesCount();
/// });

/// test.skip("set on root update", () => {
///   const updates: StorageUpdate[][] = [];
///
///   const client = new ClientStorage({
///     mutations: {
///       set,
///     },
///     storage: {},
///     actor: 0,
///     onLocalMutation: () => {},
///     onStorageChange: (storageUpdate) => updates.push(storageUpdate),
///   });
///
///   client.mutate.set("A", 1);
///
///   expect(client.toImmutable()).toStrictEqual({ A: 1 });
///   expect(updates).toEqual([
///     [
///       {
///         type: "LiveObject",
///         node: client.root,
///         updates: {
///           A: {
///             type: "update",
///           },
///         },
///       },
///     ],
///   ]);
/// });
