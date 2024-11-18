import { expect, test } from "vitest";

import { Client } from "~/Client.js";

import { put, del } from "./mutations.config.js";

test("set string", () => {
  const client = new Client({ put });
  expect(client.data).toEqual({});

  client.mutate.put("A", "A");

  expect(client.data).toEqual({ A: "A" });
});

test("set number", () => {
  const client = new Client({ put });
  expect(client.data).toEqual({});

  client.mutate.put("A", 0);

  expect(client.data).toEqual({ A: 0 });
});

test("set object", () => {
  const client = new Client({ put });
  expect(client.data).toEqual({});

  client.mutate.put("A", { foo: "bar" });

  expect(client.data).toEqual({ A: { foo: "bar" } });
});

// test("set LiveObject", () => {
//   const { clientA, assertStorage } = storageIntegrationTest({
//     initialStorage: () => ({}),
//     mutations: {
//       setLiveObject,
//     },
//   });
//
//   assertStorage({});
//
//   clientA.mutate.setLiveObject("child", "foo", "bar");
//
//   assertStorage({ child: { foo: "bar" } });
// });
//
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

  client.mutate.put("A", "A");
  expect(client.data).toEqual({ A: "A" });

  client.mutate.del("A");
  expect(client.data).toEqual({});

  client.mutate.del("A"); // Deleting again is a no-op
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
//   clientA.mutate.set("A", "A");
//   clientB.mutate.set("A", "B");
//
//   expect(clientA.toImmutable()).toStrictEqual({ A: "A" });
//   expect(clientB.toImmutable()).toStrictEqual({ A: "B" });
//   expect(server.toImmutable()).toStrictEqual({});
//
//   clientA.reconnect();
//
//   expect(clientA.toImmutable()).toStrictEqual({ A: "A" });
//   expect(clientB.toImmutable()).toStrictEqual({ A: "B" });
//   expect(server.toImmutable()).toStrictEqual({ A: "A" });
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
//     serverMutations: { set: raiseAfterSet },
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