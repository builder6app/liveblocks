import type {
  AsyncResult,
  BaseMetadata,
  CommentData,
  CommentReaction,
  CommentUserReaction,
  DistributiveOmit,
  EventSource,
  GetThreadsOptions,
  HistoryVersion,
  InboxNotificationData,
  InboxNotificationDeleteInfo,
  Observable,
  OpaqueClient,
  Patchable,
  Resolve,
  RoomNotificationSettings,
  Store,
  ThreadData,
  ThreadDataWithDeleteInfo,
  ThreadDeleteInfo,
} from "@liveblocks/core";
import {
  autoRetry,
  compactObject,
  console,
  createStore,
  kInternal,
  makeEventSource,
  mapValues,
  nanoid,
  nn,
} from "@liveblocks/core";

import { autobind } from "./lib/autobind";
import { isMoreRecentlyUpdated } from "./lib/compare";
import type {
  InboxNotificationsAsyncResult,
  RoomNotificationSettingsAsyncResult,
} from "./types";

type OptimisticUpdate<M extends BaseMetadata> =
  | CreateThreadOptimisticUpdate<M>
  | DeleteThreadOptimisticUpdate
  | EditThreadMetadataOptimisticUpdate<M>
  | MarkThreadAsResolvedOptimisticUpdate
  | MarkThreadAsUnresolvedOptimisticUpdate
  | CreateCommentOptimisticUpdate
  | EditCommentOptimisticUpdate
  | DeleteCommentOptimisticUpdate
  | AddReactionOptimisticUpdate
  | RemoveReactionOptimisticUpdate
  | MarkInboxNotificationAsReadOptimisticUpdate
  | MarkAllInboxNotificationsAsReadOptimisticUpdate
  | DeleteInboxNotificationOptimisticUpdate
  | DeleteAllInboxNotificationsOptimisticUpdate
  | UpdateNotificationSettingsOptimisticUpdate;

type CreateThreadOptimisticUpdate<M extends BaseMetadata> = {
  type: "create-thread";
  id: string;
  roomId: string;
  thread: ThreadData<M>;
};

type DeleteThreadOptimisticUpdate = {
  type: "delete-thread";
  id: string;
  roomId: string;
  threadId: string;
  deletedAt: Date;
};

type EditThreadMetadataOptimisticUpdate<M extends BaseMetadata> = {
  type: "edit-thread-metadata";
  id: string;
  threadId: string;
  metadata: Resolve<Patchable<M>>;
  updatedAt: Date;
};

type MarkThreadAsResolvedOptimisticUpdate = {
  type: "mark-thread-as-resolved";
  id: string;
  threadId: string;
  updatedAt: Date;
};

type MarkThreadAsUnresolvedOptimisticUpdate = {
  type: "mark-thread-as-unresolved";
  id: string;
  threadId: string;
  updatedAt: Date;
};

type CreateCommentOptimisticUpdate = {
  type: "create-comment";
  id: string;
  comment: CommentData;
};

type EditCommentOptimisticUpdate = {
  type: "edit-comment";
  id: string;
  comment: CommentData;
};

type DeleteCommentOptimisticUpdate = {
  type: "delete-comment";
  id: string;
  roomId: string;
  threadId: string;
  deletedAt: Date;
  commentId: string;
};

type AddReactionOptimisticUpdate = {
  type: "add-reaction";
  id: string;
  threadId: string;
  commentId: string;
  reaction: CommentUserReaction;
};

type RemoveReactionOptimisticUpdate = {
  type: "remove-reaction";
  id: string;
  threadId: string;
  commentId: string;
  emoji: string;
  userId: string;
  removedAt: Date;
};

type MarkInboxNotificationAsReadOptimisticUpdate = {
  type: "mark-inbox-notification-as-read";
  id: string;
  inboxNotificationId: string;
  readAt: Date;
};

type MarkAllInboxNotificationsAsReadOptimisticUpdate = {
  type: "mark-all-inbox-notifications-as-read";
  id: string;
  readAt: Date;
};

type DeleteInboxNotificationOptimisticUpdate = {
  type: "delete-inbox-notification";
  id: string;
  inboxNotificationId: string;
  deletedAt: Date;
};

type DeleteAllInboxNotificationsOptimisticUpdate = {
  type: "delete-all-inbox-notifications";
  id: string;
  deletedAt: Date;
};

type UpdateNotificationSettingsOptimisticUpdate = {
  type: "update-notification-settings";
  id: string;
  roomId: string;
  settings: Partial<RoomNotificationSettings>;
};

type PaginationState = {
  cursor: string | null; // If `null`, it's the last page
  isFetchingMore: boolean;
  fetchMoreError?: Error;
};

type QueryAsyncResult = AsyncResult<undefined>;
type PaginatedAsyncResult = AsyncResult<PaginationState>;

const ASYNC_LOADING = Object.freeze({ isLoading: true });
const ASYNC_OK = Object.freeze({ isLoading: false, data: undefined });

// TODO Stop exporting this helper!
export function makeNotificationSettingsQueryKey(roomId: string) {
  return `${roomId}:NOTIFICATION_SETTINGS`;
}

// TODO Stop exporting this helper!
export function makeVersionsQueryKey(roomId: string) {
  return `${roomId}-VERSIONS`;
}

/**
 * Like Promise<T>, except it will have a synchronously readable `status`
 * field, indicating the status of the promise.
 * This is compatible with React's `use()` promises, hence the name.
 */
type UsablePromise<T> = Promise<T> &
  (
    | { status: "pending" }
    | { status: "rejected"; reason: Error }
    | { status: "fulfilled"; value: T }
  );

/**
 * Given any Promise<T>, monkey-patches it to a UsablePromise<T>, whose
 * asynchronous status can be synchronously observed.
 */
function usify<T>(promise: Promise<T>): UsablePromise<T> {
  if ("status" in promise) {
    // Already a usable promise
    return promise as UsablePromise<T>;
  }

  const usable: UsablePromise<T> = promise as UsablePromise<T>;
  usable.status = "pending";
  usable.then(
    (value) => {
      usable.status = "fulfilled";
      (usable as UsablePromise<T> & { status: "fulfilled" }).value = value;
    },
    (err) => {
      usable.status = "rejected";
      (usable as UsablePromise<T> & { status: "rejected" }).reason =
        err as Error;
    }
  );
  return usable;
}

/**
 * The PaginatedResource helper class is responsible for and abstracts away the
 * following:
 *
 * - It receives a "page fetch" function of the following signature:
 *     (cursor?: Cursor) => Promise<Cursor | null>
 *
 * - Note that there is no data in the returned value!!! Storing or handling
 *   the data is NOT the responsibility of this helper class. This may be a bit
 *   counter-intuitive at first. The provided page fetcher callback function
 *   should store the data elsewhere, outside of the PaginatedResource state
 *   machine, as a side-effect of this "page fetch" function, but it can always
 *   assume the happy path. This class will deal with all the required
 *   complexity for handling the non-happy path conditions.
 *
 * - This class exposes a "getter" that you can call synchronously to get the
 *   current fetching/paginationo status for this resource. It will look like
 *   the pagination hooks, except it will not contain any data. In other words,
 *   it can return any of these shapes:
 *
 *   - { isLoading: true }
 *   - {
 *       isLoading: false,
 *       error: new Error('error while fetching'),
 *     }
 *   - {
 *       isLoading: false,
 *       data: {
 *         cursor: string | null;
 *         isFetchingMore: boolean;
 *         fetchMoreError?: Error;
 *       }
 *     }
 *
 * - When calling the getter multiple times, the return value is always
 *   referentially equal to the previous call.
 *
 * - When in this error state, the error will remain in error state for
 *   5 seconds. After those 5 seconds, the resource status gets reset, and the
 *   next time the "getter" is accessed, the resource will re-initiate the
 *   initial fetching process.
 *
 * - This class exposes an Observable that is notified whenever the state
 *   changes. For now, this observable can be used to call a no-op update to
 *   the Store (eg `.set(state => ({...state})`), to trigger a re-render for
 *   all React components.
 *
 * - This class will also expose a function that can be exposed as the
 *   `fetchMore` function which can be called externally.
 *
 * - This nicely bundles the internal state that should always be mutated
 *   together to manage all the pagination state.
 *
 * - For InboxNotifications we will have one instance of this class.
 *
 * - For Threads we will have one for each query.
 *
 * ---------------------------------------------------------------------------
 *
 * NOT 100% SURE ABOUT THE FOLLOWING YET:
 *
 * - Maybe we could eventually also let this manage the "delta updates" and the
 *   "last requested at" for this resource? Seems nice to add it here somehow.
 *   Need to think about the exact implications though.
 *
 */
class PaginatedResource {
  public readonly observable: Observable<void>;
  private _eventSource: EventSource<void>;
  private _fetchPage: (cursor?: string) => Promise<string | null>;
  private _paginationState: PaginationState | null; // Should be null while in loading or error state!

  constructor(fetchPage: (cursor?: string) => Promise<string | null>) {
    this._paginationState = null;
    this._fetchPage = fetchPage;
    this._eventSource = makeEventSource<void>();
    this.observable = this._eventSource.observable;

    autobind(this);
  }

  public fetchMore(): void {
    const state = this._paginationState;

    // We do not proceed with fetching more if any of the following is true:
    // 1) the pagination state has not be initialized
    // 2) the cursor is null, i.e., there are no more pages to fetch
    // 3) a request to fetch more is currently in progress
    if (state === null || state.cursor === null || state.isFetchingMore) return;

    // Set `isFetchingMore` to indicate that the request to fetch the next page is now in progress
    // XXX - Create a private helper which does both 1) updates pagination state 2) notifies subscribers
    this._paginationState = {
      ...state,
      isFetchingMore: true,
    };
    this._eventSource.notify();

    this._fetchPage(state.cursor)
      .then((cursor) => {
        // Update the cursor with the next cursor and set `isFetchingMore` to false
        this._paginationState = {
          ...state,
          cursor,
          isFetchingMore: false,
        };
      })
      .catch((err) => {
        this._paginationState = {
          ...state,
          isFetchingMore: false,
          fetchMoreError: err as Error,
        };
      })
      // XXX - Create a private helper which does both 1) updates pagination state 2) notifies subscribers
      .finally(() => this._eventSource.notify());
  }

  public get(): AsyncResult<{
    fetchMore: () => void;
    fetchMoreError?: Error;
    hasFetchedAll: boolean;
    isFetchingMore: boolean;
  }> {
    const usable = this._cachedPromise;
    if (usable === null || usable.status === "pending") {
      return ASYNC_LOADING;
    }

    if (usable.status === "rejected") {
      // XXX Make this a stable reference!
      return { isLoading: false, error: usable.reason };
    }

    const state = this._paginationState!;
    // XXX Make this a stable reference!
    return {
      isLoading: false,
      data: {
        fetchMore: this.fetchMore,
        isFetchingMore: state.isFetchingMore,
        fetchMoreError: state.fetchMoreError,
        hasFetchedAll: state.cursor === null,
      },
    };
  }

  private _cachedPromise: UsablePromise<void> | null = null;

  public waitUntilLoaded(): UsablePromise<void> {
    if (this._cachedPromise) {
      return this._cachedPromise;
    }

    // Wrap the request to load room threads (and notifications) in an auto-retry function so that if the request fails,
    // we retry for at most 5 times with incremental backoff delays. If all retries fail, the auto-retry function throws an error
    const initialFetcher = autoRetry(
      () => this._fetchPage(/* cursor = undefined */),
      5,
      [5000, 5000, 10000, 15000]
    );

    const promise = usify(
      initialFetcher.then((cursor) => {
        // Initial fetch completed
        this._paginationState = {
          cursor,
          isFetchingMore: false,
          fetchMoreError: undefined,
        };

        return;
      })
    );

    // XXX Maybe move this into the .then() above too?
    promise.then(
      () => this._eventSource.notify(),
      () => {
        this._eventSource.notify();

        // Wait for 5 seconds before removing the request from the cache
        setTimeout(() => {
          this._cachedPromise = null;
          this._eventSource.notify();
        }, 5_000);
      }
    );

    this._cachedPromise = promise;
    return promise;
  }
}

type InternalState<M extends BaseMetadata> = Readonly<{
  // This is a temporary refactoring artifact from Vincent and Nimesh.
  // Each query corresponds to a resource which should eventually have its own type.
  // This is why we split it for now.
  queries2: Record<string, QueryAsyncResult>; // Threads
  queries3: Record<string, QueryAsyncResult>; // Notification settings
  queries4: Record<string, QueryAsyncResult>; // Versions

  loadThreadsRequests: Record<string, UsablePromise<ThreadData<M>[]>>;

  loadNotificationsRequest: UsablePromise<InboxNotificationData[]> | null;

  optimisticUpdates: readonly OptimisticUpdate<M>[];

  rawThreadsById: Record<string, ThreadDataWithDeleteInfo<M>>;
  notificationsById: Record<string, InboxNotificationData>;
  settingsByRoomId: Record<string, RoomNotificationSettings>;
  versionsByRoomId: Record<string, HistoryVersion[]>;
}>;

/**
 * Externally observable state of the store, which will have:
 * - Optimistic updates applied
 * - All deleted threads removed from the threads list
 */
export type UmbrellaStoreState<M extends BaseMetadata> = {
  /**
   * Keep track of loading and error status of all the queries made by the client.
   * e.g. 'room-abc-{"color":"red"}'  - ok
   * e.g. 'room-abc-{}'               - loading
   */
  // TODO Query state should not be exposed publicly by the store!
  queries2: Record<string, QueryAsyncResult>; // Threads
  queries3: Record<string, QueryAsyncResult>; // Notification settings
  queries4: Record<string, QueryAsyncResult>; // Versions

  /**
   * All threads in a sorted array, optimistic updates applied, without deleted
   * threads.
   */
  threads: ThreadData<M>[];

  /**
   * All threads in a map, keyed by thread ID, with all optimistic updates
   * applied. Deleted threads are still in this mapping, and will have
   * a deletedAt field if so.
   */
  threadsById: Record<string, ThreadDataWithDeleteInfo<M>>;

  /**
   * All inbox notifications in a sorted array, optimistic updates applied.
   */
  notifications: InboxNotificationData[];

  /**
   * Inbox notifications by ID.
   * e.g. `in_${string}`
   */
  notificationsById: Record<string, InboxNotificationData>;

  /**
   * Notification settings by room ID.
   * e.g. { 'room-abc': { threads: "all" },
   *        'room-def': { threads: "replies_and_mentions" },
   *        'room-xyz': { threads: "none" },
   *      }
   */
  settingsByRoomId: Record<string, RoomNotificationSettings>;
  /**
   * Versions by roomId
   * e.g. { 'room-abc': {versions: "all versions"}}
   */
  versionsByRoomId: Record<string, HistoryVersion[]>;
};

export class UmbrellaStore<M extends BaseMetadata> {
  private _client?: OpaqueClient;
  private _store: Store<InternalState<M>>;
  private _prevState: InternalState<M> | null = null;
  private _stateCached: UmbrellaStoreState<M> | null = null;
  private _lastRequestedThreadsAtByRoom = new Map<string, Date>(); // A map of room ids to the timestamp when the last request for threads updates was made
  private _requestStatusByRoom = new Map<string, boolean>(); // A map of room ids to a boolean indicating whether a request to retrieve threads updates is in progress
  private _lastRequestedNotificationsAt: Date | null = null; // Keeps track of when we successfully requested an inbox notifications update for the last time. Will be `null` as long as the first successful fetch hasn't happened yet.
  private _notificationsPaginatedResource: PaginatedResource;

  constructor(client?: OpaqueClient) {
    const inboxFetcher = async (cursor?: string) => {
      const result = await client!.getInboxNotifications({ cursor });

      this.updateThreadsAndNotifications(
        result.threads as ThreadData<M>[], // TODO: Figure out how to remove this casting
        result.inboxNotifications
      );

      // We initialize the `_lastRequestedNotificationsAt` date using the server timestamp after we've loaded the first page of inbox notifications.
      if (this._lastRequestedNotificationsAt === null) {
        this._lastRequestedNotificationsAt = result.requestedAt;
      }

      const nextCursor = result.nextCursor;
      return nextCursor;
    };

    this._client = client;

    this._notificationsPaginatedResource = new PaginatedResource(inboxFetcher);
    this._notificationsPaginatedResource.observable.subscribe(() =>
      this._store.set((store) => ({ ...store }))
    );

    this._store = createStore<InternalState<M>>({
      rawThreadsById: {},
      loadThreadsRequests: {},
      loadNotificationsRequest: null,
      queries2: {},
      queries3: {},
      queries4: {},
      optimisticUpdates: [],
      notificationsById: {},
      settingsByRoomId: {},
      versionsByRoomId: {},
    });

    // Auto-bind all of this class’ methods here, so we can use stable
    // references to them (most important for use in useSyncExternalStore)
    autobind(this);
  }

  private get(): UmbrellaStoreState<M> {
    // Don't return the raw internal state immediately! Return a new computed
    // cached state (with optimistic updates applied) instead, and cache that
    // until the next .set() call invalidates it.
    const rawState = this._store.get();
    if (this._prevState !== rawState || this._stateCached === null) {
      this._prevState = rawState;
      this._stateCached = internalToExternalState(rawState);
    }
    return this._stateCached;
  }

  public batch(callback: () => void): void {
    return this._store.batch(callback);
  }

  public getFullState(): UmbrellaStoreState<M> {
    return this.get();
  }

  /**
   * Returns the async result of the given queryKey. If the query is success,
   * then it will return the entire store's state in the payload.
   */
  // TODO: This return type is a bit weird! Feels like we haven't found the
  // right abstraction here yet.
  public getThreadsAsync(
    queryKey: string
  ): AsyncResult<UmbrellaStoreState<M>, "fullState"> {
    const internalState = this._store.get();

    const request = internalState.loadThreadsRequests[queryKey];
    if (request === undefined || request.status === "pending") {
      return ASYNC_LOADING;
    }

    if (request.status === "rejected") {
      return {
        isLoading: false,
        error: request.reason,
      };
    }

    // TODO Memoize this value to ensure stable result, so we won't have to use the selector and isEqual functions!
    return { isLoading: false, fullState: this.getFullState() };
  }

  public getUserThreadsAsync(
    queryKey: string
  ): AsyncResult<UmbrellaStoreState<M>, "fullState"> {
    const internalState = this._store.get();

    const query = internalState.queries2[queryKey];
    if (query === undefined || query.isLoading) {
      return ASYNC_LOADING;
    }

    if (query.error) {
      return query;
    }

    // TODO Memoize this value to ensure stable result, so we won't have to use the selector and isEqual functions!
    return { isLoading: false, fullState: this.getFullState() };
  }

  // NOTE: This will read the async result, but WILL NOT start loading at the moment!
  public getInboxNotificationsAsync(): InboxNotificationsAsyncResult {
    const notificationState = this._notificationsPaginatedResource.get();
    if (notificationState.isLoading || notificationState.error) {
      return notificationState;
    }

    const pageState = notificationState.data;
    // TODO Memoize this value to ensure stable result, so we won't have to use the selector and isEqual functions!
    return {
      isLoading: false,
      ...pageState,
      inboxNotifications: this.getFullState().notifications,
    };
  }

  // NOTE: This will read the async result, but WILL NOT start loading at the moment!
  public getNotificationSettingsAsync(
    roomId: string
  ): RoomNotificationSettingsAsyncResult {
    const state = this.get();

    const query = state.queries3[makeNotificationSettingsQueryKey(roomId)];
    if (query === undefined || query.isLoading) {
      return ASYNC_LOADING;
    }

    if (query.error !== undefined) {
      return query;
    }

    // TODO Memoize this value to ensure stable result, so we won't have to use the selector and isEqual functions!
    return {
      isLoading: false,
      settings: nn(state.settingsByRoomId[roomId]),
    };
  }

  public getVersionsAsync(
    roomId: string
  ): AsyncResult<HistoryVersion[], "versions"> {
    const state = this.get();

    const query = state.queries4[makeVersionsQueryKey(roomId)];
    if (query === undefined || query.isLoading) {
      return ASYNC_LOADING;
    }

    if (query.error !== undefined) {
      return query;
    }

    // TODO Memoize this value to ensure stable result, so we won't have to use the selector and isEqual functions!
    return {
      isLoading: false,
      versions: nn(state.versionsByRoomId[roomId]),
    };
  }

  /**
   * @private Only used by the E2E test suite.
   */
  public _hasOptimisticUpdates(): boolean {
    return this._store.get().optimisticUpdates.length > 0;
  }

  private subscribe(callback: () => void): () => void {
    return this._store.subscribe(callback);
  }

  /**
   * @private Only used by the E2E test suite.
   */
  public _subscribeOptimisticUpdates(callback: () => void): () => void {
    // TODO Make this actually only update when optimistic updates are changed
    return this.subscribe(callback);
  }

  public subscribeThreads(callback: () => void): () => void {
    // TODO Make this actually only update when threads are invalidated
    return this.subscribe(callback);
  }

  public subscribeUserThreads(callback: () => void): () => void {
    // TODO Make this actually only update when threads are invalidated
    return this.subscribe(callback);
  }

  public subscribeThreadsOrInboxNotifications(
    callback: () => void
  ): () => void {
    // TODO Make this actually only update when inbox notifications are invalidated
    return this.subscribe(callback);
  }

  public subscribeNotificationSettings(callback: () => void): () => void {
    // TODO Make this actually only update when notification settings are invalidated
    return this.subscribe(callback);
  }

  public subscribeVersions(callback: () => void): () => void {
    // TODO Make this actually only update when versions are invalidated
    return this.subscribe(callback);
  }

  // Direct low-level cache mutations ------------------------------------------------- {{{

  private updateThreadsCache(
    mapFn: (
      cache: Readonly<Record<string, ThreadDataWithDeleteInfo<M>>>
    ) => Readonly<Record<string, ThreadDataWithDeleteInfo<M>>>
  ): void {
    this._store.set((state) => {
      const threads = mapFn(state.rawThreadsById);
      return threads !== state.rawThreadsById
        ? { ...state, rawThreadsById: threads }
        : state;
    });
  }

  private updateInboxNotificationsCache(
    mapFn: (
      cache: Readonly<Record<string, InboxNotificationData>>
    ) => Readonly<Record<string, InboxNotificationData>>
  ): void {
    this._store.set((state) => {
      const inboxNotifications = mapFn(state.notificationsById);
      return inboxNotifications !== state.notificationsById
        ? { ...state, notificationsById: inboxNotifications }
        : state;
    });
  }

  private setNotificationSettings(
    roomId: string,
    settings: RoomNotificationSettings
  ): void {
    this._store.set((state) => ({
      ...state,
      settingsByRoomId: {
        ...state.settingsByRoomId,
        [roomId]: settings,
      },
    }));
  }

  private setVersions(roomId: string, versions: HistoryVersion[]): void {
    this._store.set((state) => ({
      ...state,
      versionsByRoomId: {
        ...state.versionsByRoomId,
        [roomId]: versions,
      },
    }));
  }

  private setQuery1State(queryState: PaginatedAsyncResult): void {
    this._store.set((state) => ({
      ...state,
      query1: queryState,
    }));
  }

  private setQuery2State(queryKey: string, queryState: QueryAsyncResult): void {
    this._store.set((state) => ({
      ...state,
      queries2: {
        ...state.queries2,
        [queryKey]: queryState,
      },
    }));
  }
  private setQuery3State(queryKey: string, queryState: QueryAsyncResult): void {
    this._store.set((state) => ({
      ...state,
      queries3: {
        ...state.queries3,
        [queryKey]: queryState,
      },
    }));
  }

  private setQuery4State(queryKey: string, queryState: QueryAsyncResult): void {
    this._store.set((state) => ({
      ...state,
      queries4: {
        ...state.queries4,
        [queryKey]: queryState,
      },
    }));
  }

  private updateOptimisticUpdatesCache(
    mapFn: (
      cache: readonly OptimisticUpdate<M>[]
    ) => readonly OptimisticUpdate<M>[]
  ): void {
    this._store.set((state) => ({
      ...state,
      optimisticUpdates: mapFn(state.optimisticUpdates),
    }));
  }

  // ---------------------------------------------------------------------------------- }}}

  /** @internal - Only call this method from unit tests. */
  public force_set(
    callback: (currentState: InternalState<M>) => InternalState<M>
  ): void {
    return this._store.set(callback);
  }

  /**
   * Updates an existing inbox notification with a new value, replacing the
   * corresponding optimistic update.
   *
   * This will not update anything if the inbox notification ID isn't found in
   * the cache.
   */
  public updateInboxNotification(
    inboxNotificationId: string,
    optimisticUpdateId: string,
    callback: (
      notification: Readonly<InboxNotificationData>
    ) => Readonly<InboxNotificationData>
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.removeOptimisticUpdate(optimisticUpdateId); // 1️⃣

      // 2️⃣
      this.updateInboxNotificationsCache((cache) => {
        const existing = cache[inboxNotificationId];
        if (!existing) {
          // If the inbox notification doesn't exist in the cache, we do not
          // change anything
          return cache;
        }

        const inboxNotifications = {
          ...cache,
          [inboxNotificationId]: callback(existing),
        };
        return inboxNotifications;
      });
    });
  }

  /**
   * Updates *all* inbox notifications by running a mapper function over all of
   * them, replacing the corresponding optimistic update.
   */
  public updateAllInboxNotifications(
    optimisticUpdateId: string,
    mapFn: (
      notification: Readonly<InboxNotificationData>
    ) => Readonly<InboxNotificationData>
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.removeOptimisticUpdate(optimisticUpdateId); // 1️⃣
      this.updateInboxNotificationsCache((cache) => mapValues(cache, mapFn)); // 2️⃣
    });
  }

  /**
   * Deletes an existing inbox notification, replacing the corresponding
   * optimistic update.
   */
  public deleteInboxNotification(
    inboxNotificationId: string,
    optimisticUpdateId: string
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.removeOptimisticUpdate(optimisticUpdateId); // 1️⃣

      // 2️⃣
      this.updateInboxNotificationsCache((cache) => {
        // Delete it
        const { [inboxNotificationId]: removed, ...newCache } = cache;
        return removed === undefined ? cache : newCache;
      });
    });
  }

  /**
   * Deletes *all* inbox notifications, replacing the corresponding optimistic
   * update.
   */
  public deleteAllInboxNotifications(optimisticUpdateId: string): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.removeOptimisticUpdate(optimisticUpdateId); // 1️⃣
      this.updateInboxNotificationsCache(() => ({})); // 2️⃣ empty the cache
    });
  }

  /**
   * Creates an new thread, replacing the corresponding optimistic update.
   */
  public createThread(
    optimisticUpdateId: string,
    thread: Readonly<ThreadDataWithDeleteInfo<M>>
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.removeOptimisticUpdate(optimisticUpdateId); // 1️⃣j
      this.updateThreadsCache((cache) => ({ ...cache, [thread.id]: thread })); // 2️⃣
    });
  }

  /**
   * Updates an existing thread with a new value, replacing the corresponding
   * optimistic update.
   *
   * This will not update anything if:
   * - The thread ID isn't found in the cache; or
   * - The thread ID was already deleted from the cache; or
   * - The thread ID in the cache was updated more recently than the optimistic
   *   update's timestamp (if given)
   */
  private updateThread(
    threadId: string,
    optimisticUpdateId: string | null,
    callback: (
      thread: Readonly<ThreadDataWithDeleteInfo<M>>
    ) => Readonly<ThreadDataWithDeleteInfo<M>>,
    updatedAt?: Date // TODO We could look this up from the optimisticUpdate instead?
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      if (optimisticUpdateId !== null) {
        this.removeOptimisticUpdate(optimisticUpdateId); // 1️⃣
      }

      // 2️⃣
      this.updateThreadsCache((cache) => {
        const existing = cache[threadId];

        // If the thread doesn't exist in the cache, we do not update the metadata
        if (!existing) {
          return cache;
        }

        // If the thread has been deleted, we do not update the metadata
        if (existing.deletedAt !== undefined) {
          return cache;
        }

        if (
          !!updatedAt &&
          !!existing.updatedAt &&
          existing.updatedAt > updatedAt
        ) {
          return cache;
        }

        return { ...cache, [threadId]: callback(existing) };
      });
    });
  }

  public patchThread(
    threadId: string,
    optimisticUpdateId: string | null,
    patch: {
      // Only these fields are currently supported to patch
      metadata?: M;
      resolved?: boolean;
    },
    updatedAt: Date // TODO We could look this up from the optimisticUpdate instead?
  ): void {
    return this.updateThread(
      threadId,
      optimisticUpdateId,
      (thread) => ({ ...thread, ...compactObject(patch) }),
      updatedAt
    );
  }

  public addReaction(
    threadId: string,
    optimisticUpdateId: string | null,
    commentId: string,
    reaction: CommentUserReaction,
    createdAt: Date // TODO We could look this up from the optimisticUpdate instead?
  ): void {
    this.updateThread(
      threadId,
      optimisticUpdateId,
      (thread) => applyAddReaction(thread, commentId, reaction),
      createdAt
    );
  }

  public removeReaction(
    threadId: string,
    optimisticUpdateId: string | null,
    commentId: string,
    emoji: string,
    userId: string,
    removedAt: Date
  ): void {
    this.updateThread(
      threadId,
      optimisticUpdateId,
      (thread) =>
        applyRemoveReaction(thread, commentId, emoji, userId, removedAt),
      removedAt
    );
  }

  /**
   * Soft-deletes an existing thread by setting its `deletedAt` value,
   * replacing the corresponding optimistic update.
   *
   * This will not update anything if:
   * - The thread ID isn't found in the cache; or
   * - The thread ID was already deleted from the cache
   */
  public deleteThread(
    threadId: string,
    optimisticUpdateId: string | null
  ): void {
    return this.updateThread(
      threadId,
      optimisticUpdateId,

      // A deletion is actually an update of the deletedAt property internally
      (thread) => ({ ...thread, updatedAt: new Date(), deletedAt: new Date() })
    );
  }

  /**
   * Creates an existing comment and ensures the associated notification is
   * updated correctly, replacing the corresponding optimistic update.
   */
  public createComment(
    newComment: CommentData,
    optimisticUpdateId: string
  ): void {
    // Batch 1️⃣ + 2️⃣ + 3️⃣
    this._store.batch(() => {
      // 1️⃣
      this.removeOptimisticUpdate(optimisticUpdateId);

      // If the associated thread is not found, we cannot create a comment under it
      const existingThread =
        this._store.get().rawThreadsById[newComment.threadId];
      if (!existingThread) {
        return;
      }

      // 2️⃣ Update the thread instance by adding a comment under it
      this.updateThreadsCache((cache) => ({
        ...cache,
        [newComment.threadId]: applyUpsertComment(existingThread, newComment),
      }));

      // 3️⃣ Update the associated inbox notification (if any)
      this.updateInboxNotificationsCache((cache) => {
        const existingNotification = Object.values(cache).find(
          (notification) =>
            notification.kind === "thread" &&
            notification.threadId === newComment.threadId
        );

        if (!existingNotification) {
          // Nothing to update here
          return cache;
        }

        // If the thread has an inbox notification associated with it, we update the notification's `notifiedAt` and `readAt` values
        return {
          ...cache,
          [existingNotification.id]: {
            ...existingNotification,
            notifiedAt: newComment.createdAt,
            readAt: newComment.createdAt,
          },
        };
      });
    });
  }

  public editComment(
    threadId: string,
    optimisticUpdateId: string,
    editedComment: CommentData
  ): void {
    return this.updateThread(threadId, optimisticUpdateId, (thread) =>
      applyUpsertComment(thread, editedComment)
    );
  }

  public deleteComment(
    threadId: string,
    optimisticUpdateId: string,
    commentId: string,
    deletedAt: Date
  ): void {
    return this.updateThread(
      threadId,
      optimisticUpdateId,
      (thread) => applyDeleteComment(thread, commentId, deletedAt),
      deletedAt
    );
  }

  public updateThreadAndNotification(
    thread: ThreadData<M>,
    inboxNotification?: InboxNotificationData
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      // 1️⃣
      this.updateThreadsCache((cache) => {
        const existingThread = cache[thread.id];
        return existingThread === undefined ||
          isMoreRecentlyUpdated(thread, existingThread)
          ? { ...cache, [thread.id]: thread }
          : cache;
      });

      // 2️⃣
      if (inboxNotification !== undefined) {
        this.updateInboxNotificationsCache((cache) => ({
          ...cache,
          [inboxNotification.id]: inboxNotification,
        }));
      }
    });
  }

  public updateThreadsAndNotifications(
    threads: ThreadData<M>[],
    inboxNotifications: InboxNotificationData[]
  ): void;
  public updateThreadsAndNotifications(
    threads: ThreadData<M>[],
    inboxNotifications: InboxNotificationData[],
    deletedThreads: ThreadDeleteInfo[],
    deletedInboxNotifications: InboxNotificationDeleteInfo[]
  ): void;
  public updateThreadsAndNotifications(
    threads: ThreadData<M>[],
    inboxNotifications: InboxNotificationData[],
    deletedThreads: ThreadDeleteInfo[] = [],
    deletedInboxNotifications: InboxNotificationDeleteInfo[] = []
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      // 1️⃣
      this.updateThreadsCache((cache) =>
        applyThreadUpdates(cache, {
          newThreads: threads,
          deletedThreads,
        })
      );

      // 2️⃣
      this.updateInboxNotificationsCache((cache) =>
        applyNotificationsUpdates(cache, {
          newInboxNotifications: inboxNotifications,
          deletedNotifications: deletedInboxNotifications,
        })
      );
    });
  }

  /**
   * Updates existing notification setting for a room with a new value,
   * replacing the corresponding optimistic update.
   */
  public updateRoomInboxNotificationSettings2(
    roomId: string,
    optimisticUpdateId: string,
    settings: Readonly<RoomNotificationSettings>
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.removeOptimisticUpdate(optimisticUpdateId); // 1️⃣
      this.setNotificationSettings(roomId, settings); // 2️⃣
    });
  }

  public updateRoomInboxNotificationSettings(
    roomId: string,
    settings: RoomNotificationSettings,
    queryKey: string
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.setQuery3OK(queryKey); // 1️⃣
      this.setNotificationSettings(roomId, settings); // 2️⃣
    });
  }

  public updateRoomVersions(
    roomId: string,
    versions: HistoryVersion[],
    queryKey?: string
  ): void {
    // Batch 1️⃣ + 2️⃣
    this._store.batch(() => {
      this.setVersions(roomId, versions); // 1️⃣

      // 2️⃣
      if (queryKey !== undefined) {
        this.setQuery4OK(queryKey);
      }
    });
  }

  public addOptimisticUpdate(
    optimisticUpdate: DistributiveOmit<OptimisticUpdate<M>, "id">
  ): string {
    const id = nanoid();
    const newUpdate: OptimisticUpdate<M> = { ...optimisticUpdate, id };
    this.updateOptimisticUpdatesCache((cache) => [...cache, newUpdate]);
    return id;
  }

  public removeOptimisticUpdate(optimisticUpdateId: string): void {
    this.updateOptimisticUpdatesCache((cache) =>
      cache.filter((ou) => ou.id !== optimisticUpdateId)
    );
  }

  //
  // Query State APIs
  //

  // Query 1
  public setQuery1Loading(): void {
    this.setQuery1State(ASYNC_LOADING);
  }

  public setQuery1OK(pageState: PaginationState): void {
    this.setQuery1State({ isLoading: false, data: pageState });
  }

  public setQuery1Error(error: Error): void {
    this.setQuery1State({ isLoading: false, error });
  }

  // Query 2
  public setQuery2Loading(queryKey: string): void {
    this.setQuery2State(queryKey, ASYNC_LOADING);
  }

  public setQuery2OK(queryKey: string): void {
    this.setQuery2State(queryKey, ASYNC_OK);
  }

  public setQuery2Error(queryKey: string, error: Error): void {
    this.setQuery2State(queryKey, { isLoading: false, error });
  }

  // Query 3
  public setQuery3Loading(queryKey: string): void {
    this.setQuery3State(queryKey, ASYNC_LOADING);
  }

  private setQuery3OK(queryKey: string): void {
    this.setQuery3State(queryKey, ASYNC_OK);
  }

  public setQuery3Error(queryKey: string, error: Error): void {
    this.setQuery3State(queryKey, { isLoading: false, error });
  }

  // Query 4
  public setQuery4Loading(queryKey: string): void {
    this.setQuery4State(queryKey, ASYNC_LOADING);
  }

  private setQuery4OK(queryKey: string): void {
    this.setQuery4State(queryKey, ASYNC_OK);
  }

  public setQuery4Error(queryKey: string, error: Error): void {
    this.setQuery4State(queryKey, { isLoading: false, error });
  }

  public async fetchNotificationsDeltaUpdate() {
    const lastRequestedAt = this._lastRequestedNotificationsAt;
    if (lastRequestedAt === null) return;

    const client = nn(
      this._client,
      "Client is required in order to load notifications for the room"
    );

    const result = await client.getInboxNotificationsSince(lastRequestedAt);

    if (lastRequestedAt < result.requestedAt) {
      this._lastRequestedNotificationsAt = result.requestedAt;
    }

    this.updateThreadsAndNotifications(
      result.threads.updated as ThreadData<M>[],
      result.inboxNotifications.updated,
      result.threads.deleted,
      result.inboxNotifications.deleted
    );
  }

  public waitUntilNotificationsLoaded(): UsablePromise<void> {
    return this._notificationsPaginatedResource.waitUntilLoaded();
  }

  public loadThreads(
    roomId: string,
    options: GetThreadsOptions<BaseMetadata>,
    queryKey: string
  ) {
    void this.waitUntilThreadsLoaded(roomId, options, queryKey).catch(() => {
      // Deliberately catch and ignore any errors here.
      // TODO: This is so that the hook (useThreads) calling this method doesn't throw an error. This logic should likely stay locally inside the hook.
    });
  }

  public waitUntilThreadsLoaded(
    roomId: string,
    options: GetThreadsOptions<BaseMetadata>,
    queryKey: string
  ): UsablePromise<ThreadData[]> {
    const internalStore = this._store.get();

    // If a request was already made for the provided query key, we simply return the existing request.
    // We do not want to override the existing request with a new request to load threads and notifications
    const existingRequest = internalStore.loadThreadsRequests[queryKey];
    if (existingRequest !== undefined) return existingRequest;

    const fetchThreads = async (): Promise<ThreadData<M>[]> => {
      // XXX Make this throw a StopRetrying error instance!
      const client = nn(
        this._client,
        "Client is required in order to load threads and notifications for the room"
      );
      const room = client.getRoom(roomId);
      if (room === null) {
        throw new Error(`Room with id ${roomId} is not available on client`);
      }

      // Wrap the request to load room threads (and notifications) in an auto-retry function so that if the request fails,
      // we retry for at most 5 times with incremental backoff delays. If all retries fail, the auto-retry function throws an error
      return await autoRetry(
        async () => {
          const result = await room.getThreads(options);

          this.updateThreadsAndNotifications(
            result.threads as ThreadData<M>[], // TODO: Figure out how to remove this casting
            result.inboxNotifications
          );

          const lastRequestedAt =
            this._lastRequestedThreadsAtByRoom.get(roomId);

          /**
           * We set the `lastRequestedAt` value for the room to the timestamp returned by the current request if:
           * 1. The `lastRequestedAt` value for the room has not been set
           * OR
           * 2. The `lastRequestedAt` value for the room is older than the timestamp returned by the current request
           */
          if (
            lastRequestedAt === undefined ||
            lastRequestedAt > result.requestedAt
          ) {
            this._lastRequestedThreadsAtByRoom.set(roomId, result.requestedAt);
          }

          return result.threads as ThreadData<M>[];
        },
        5,
        [5000, 5000, 10000, 15000]
      );
    };

    const fetchThreadsPromise = usify(fetchThreads());

    this._store.set((state) => ({
      ...state,
      loadThreadsRequests: {
        ...state.loadThreadsRequests,
        [queryKey]: fetchThreadsPromise,
      },
    }));

    fetchThreadsPromise
      .then(() => {
        // Manually mark the state as dirty and update the store so that any subscribers are notified
        this._store.set((state) => ({ ...state }));
      })
      .catch(() => {
        // Manually mark the state as dirty and update the store so that any subscribers are notified
        this._store.set((state) => ({ ...state }));

        // Wait for 5 seconds before removing the request from the cache
        setTimeout(() => {
          this._store.set((state) => {
            const { [queryKey]: _, ...requests } = state.loadThreadsRequests;
            return {
              ...state,
              loadThreadsRequests: requests,
            };
          });
        }, 5000);
      });

    return fetchThreadsPromise;
  }

  /**
   * Retrieve threads that have been updated/deleted since the last time the room requested threads updates and update the local cache with the new data
   * @param roomId The id of the room for which to retrieve threads updates
   * XXX - Match the name and implementation with the equivalent function for inbox notifications (currently named `fetchNotificationsDeltaUpdate`)
   */
  public async getThreadsUpdates(roomId: string) {
    const DEFAULT_DEDUPING_INTERVAL = 2000; // 2 seconds

    const since = this._lastRequestedThreadsAtByRoom.get(roomId);
    if (since === undefined) return;

    const isFetchingThreadsUpdates =
      this._requestStatusByRoom.get(roomId) ?? false;
    // If another request to retrieve threads updates for the room is in progress, we do not start a new one
    if (isFetchingThreadsUpdates === true) return;
    try {
      // Set the isFetchingThreadsUpdates flag to true to prevent multiple requests to fetch threads updates for the room from being made at the same time
      this._requestStatusByRoom.set(roomId, true);

      const updates = await nn(
        this._client,
        "Client is required in order to load threads and notifications for the room"
      )[kInternal].getRoomThreadsSince(roomId, { since });

      // Set the isFetchingThreadsUpdates flag to false after a certain interval to prevent multiple requests from being made at the same time
      setTimeout(() => {
        this._requestStatusByRoom.set(roomId, false);
      }, DEFAULT_DEDUPING_INTERVAL);

      this.updateThreadsAndNotifications(
        updates.threads.updated as ThreadData<M>[], // TODO: Figure out how to remove this casting,
        updates.inboxNotifications.updated,
        updates.threads.deleted,
        updates.inboxNotifications.deleted
      );

      // Update the `lastRequestedAt` value for the room to the timestamp returned by the current request
      this._lastRequestedThreadsAtByRoom.set(roomId, updates.requestedAt);
    } catch (err) {
      this._requestStatusByRoom.set(roomId, false);
      // TODO: Implement error handling
      return;
    }
  }
}

/**
 * Applies optimistic updates, removes deleted threads, sorts results in
 * a stable way, removes internal fields that should not be exposed publicly.
 */
function internalToExternalState<M extends BaseMetadata>(
  state: InternalState<M>
): UmbrellaStoreState<M> {
  const computed = {
    threadsById: { ...state.rawThreadsById },
    notificationsById: { ...state.notificationsById },
    settingsByRoomId: { ...state.settingsByRoomId },
  };

  for (const optimisticUpdate of state.optimisticUpdates) {
    switch (optimisticUpdate.type) {
      case "create-thread": {
        computed.threadsById[optimisticUpdate.thread.id] =
          optimisticUpdate.thread;
        break;
      }
      case "edit-thread-metadata": {
        const thread = computed.threadsById[optimisticUpdate.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        // If the thread has been deleted, we do not apply the update
        if (thread.deletedAt !== undefined) {
          break;
        }

        // If the thread has been updated since the optimistic update, we do not apply the update
        if (
          thread.updatedAt !== undefined &&
          thread.updatedAt > optimisticUpdate.updatedAt
        ) {
          break;
        }

        computed.threadsById[thread.id] = {
          ...thread,
          updatedAt: optimisticUpdate.updatedAt,
          metadata: {
            ...thread.metadata,
            ...optimisticUpdate.metadata,
          },
        };

        break;
      }
      case "mark-thread-as-resolved": {
        const thread = computed.threadsById[optimisticUpdate.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        // If the thread has been deleted, we do not apply the update
        if (thread.deletedAt !== undefined) {
          break;
        }

        computed.threadsById[thread.id] = {
          ...thread,
          resolved: true,
        };

        break;
      }
      case "mark-thread-as-unresolved": {
        const thread = computed.threadsById[optimisticUpdate.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        // If the thread has been deleted, we do not apply the update
        if (thread.deletedAt !== undefined) {
          break;
        }

        computed.threadsById[thread.id] = {
          ...thread,
          resolved: false,
        };

        break;
      }
      case "create-comment": {
        const thread = computed.threadsById[optimisticUpdate.comment.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        computed.threadsById[thread.id] = applyUpsertComment(
          thread,
          optimisticUpdate.comment
        );

        const inboxNotification = Object.values(
          computed.notificationsById
        ).find(
          (notification) =>
            notification.kind === "thread" &&
            notification.threadId === thread.id
        );

        if (inboxNotification === undefined) {
          break;
        }

        computed.notificationsById[inboxNotification.id] = {
          ...inboxNotification,
          notifiedAt: optimisticUpdate.comment.createdAt,
          readAt: optimisticUpdate.comment.createdAt,
        };

        break;
      }
      case "edit-comment": {
        const thread = computed.threadsById[optimisticUpdate.comment.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        computed.threadsById[thread.id] = applyUpsertComment(
          thread,
          optimisticUpdate.comment
        );

        break;
      }
      case "delete-comment": {
        const thread = computed.threadsById[optimisticUpdate.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        computed.threadsById[thread.id] = applyDeleteComment(
          thread,
          optimisticUpdate.commentId,
          optimisticUpdate.deletedAt
        );

        break;
      }

      case "delete-thread": {
        const thread = computed.threadsById[optimisticUpdate.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        computed.threadsById[optimisticUpdate.threadId] = {
          ...thread,
          deletedAt: optimisticUpdate.deletedAt,
          updatedAt: optimisticUpdate.deletedAt,
          comments: [],
        };
        break;
      }
      case "add-reaction": {
        const thread = computed.threadsById[optimisticUpdate.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        computed.threadsById[thread.id] = applyAddReaction(
          thread,
          optimisticUpdate.commentId,
          optimisticUpdate.reaction
        );

        break;
      }
      case "remove-reaction": {
        const thread = computed.threadsById[optimisticUpdate.threadId];
        // If the thread doesn't exist in the cache, we do not apply the update
        if (thread === undefined) {
          break;
        }

        computed.threadsById[thread.id] = applyRemoveReaction(
          thread,
          optimisticUpdate.commentId,
          optimisticUpdate.emoji,
          optimisticUpdate.userId,
          optimisticUpdate.removedAt
        );

        break;
      }
      case "mark-inbox-notification-as-read": {
        const ibn =
          computed.notificationsById[optimisticUpdate.inboxNotificationId];

        // If the inbox notification doesn't exist in the cache, we do not apply the update
        if (ibn === undefined) {
          break;
        }

        computed.notificationsById[optimisticUpdate.inboxNotificationId] = {
          ...ibn,
          readAt: optimisticUpdate.readAt,
        };
        break;
      }
      case "mark-all-inbox-notifications-as-read": {
        for (const id in computed.notificationsById) {
          const ibn = computed.notificationsById[id];

          // If the inbox notification doesn't exist in the cache, we do not apply the update
          if (ibn === undefined) {
            break;
          }

          computed.notificationsById[id] = {
            ...ibn,
            readAt: optimisticUpdate.readAt,
          };
        }
        break;
      }
      case "delete-inbox-notification": {
        delete computed.notificationsById[optimisticUpdate.inboxNotificationId];
        break;
      }
      case "delete-all-inbox-notifications": {
        computed.notificationsById = {};
        break;
      }

      case "update-notification-settings": {
        const settings = computed.settingsByRoomId[optimisticUpdate.roomId];

        // If the inbox notification doesn't exist in the cache, we do not apply the update
        if (settings === undefined) {
          break;
        }

        computed.settingsByRoomId[optimisticUpdate.roomId] = {
          ...settings,
          ...optimisticUpdate.settings,
        };
      }
    }
  }

  const cleanedThreads =
    // Don't expose any soft-deleted threads
    Object.values(computed.threadsById)
      .filter((thread): thread is ThreadData<M> => !thread.deletedAt)

      .filter((thread) =>
        // Only keep a thread if there is at least one non-deleted comment
        thread.comments.some((c) => c.deletedAt === undefined)
      );

  // TODO Maybe consider also removing these from the inboxNotificationsById registry?
  const cleanedNotifications =
    // Sort so that the most recent notifications are first
    Object.values(computed.notificationsById)
      .filter((ibn) =>
        ibn.kind === "thread"
          ? computed.threadsById[ibn.threadId] &&
            computed.threadsById[ibn.threadId]?.deletedAt === undefined
          : true
      )
      .sort((a, b) => b.notifiedAt.getTime() - a.notifiedAt.getTime());

  return {
    notifications: cleanedNotifications,
    notificationsById: computed.notificationsById,
    settingsByRoomId: computed.settingsByRoomId,
    queries2: state.queries2,
    queries3: state.queries3,
    queries4: state.queries4,
    threads: cleanedThreads,
    threadsById: computed.threadsById,
    versionsByRoomId: state.versionsByRoomId,
  };
}

export function applyThreadUpdates<M extends BaseMetadata>(
  existingThreads: Record<string, ThreadDataWithDeleteInfo<M>>,
  updates: {
    newThreads: ThreadData<M>[];
    deletedThreads: ThreadDeleteInfo[];
  }
): Record<string, ThreadData<M>> {
  const updatedThreads = { ...existingThreads };

  // Add new threads or update existing threads if the existing thread is older than the new thread.
  updates.newThreads.forEach((thread) => {
    const existingThread = updatedThreads[thread.id];

    // If a thread already exists but it's been already more recent, don't update it
    if (existingThread) {
      if (isMoreRecentlyUpdated(existingThread, thread)) {
        return; // Do not update the existing thread
      }
    }

    updatedThreads[thread.id] = thread;
  });

  // Mark threads in the deletedThreads list as deleted
  updates.deletedThreads.forEach(({ id, deletedAt }) => {
    const existingThread = updatedThreads[id];
    if (existingThread === undefined) return;

    existingThread.deletedAt = deletedAt;
    existingThread.updatedAt = deletedAt;
    existingThread.comments = [];
  });

  return updatedThreads;
}

export function applyNotificationsUpdates(
  existingInboxNotifications: Record<string, InboxNotificationData>,
  updates: {
    newInboxNotifications: InboxNotificationData[];
    deletedNotifications: InboxNotificationDeleteInfo[];
  }
): Record<string, InboxNotificationData> {
  const updatedInboxNotifications = { ...existingInboxNotifications };

  // Add new notifications or update existing notifications if the existing notification is older than the new notification.
  updates.newInboxNotifications.forEach((notification) => {
    const existingNotification = updatedInboxNotifications[notification.id];
    // If the notification already exists, we need to compare the two notifications to determine which one is newer.
    if (existingNotification) {
      const result = compareInboxNotifications(
        existingNotification,
        notification
      );

      // If the existing notification is newer than the new notification, we do not update the existing notification.
      if (result === 1) return;
    }

    // If the new notification is newer than the existing notification, we update the existing notification.
    updatedInboxNotifications[notification.id] = notification;
  });

  updates.deletedNotifications.forEach(
    ({ id }) => delete updatedInboxNotifications[id]
  );

  return updatedInboxNotifications;
}

/**
 * Compares two inbox notifications to determine which one is newer.
 * @param inboxNotificationA The first inbox notification to compare.
 * @param inboxNotificationB The second inbox notification to compare.
 * @returns 1 if inboxNotificationA is newer, -1 if inboxNotificationB is newer, or 0 if they are the same age or can't be compared.
 */
export function compareInboxNotifications(
  inboxNotificationA: InboxNotificationData,
  inboxNotificationB: InboxNotificationData
): number {
  if (inboxNotificationA.notifiedAt > inboxNotificationB.notifiedAt) {
    return 1;
  } else if (inboxNotificationA.notifiedAt < inboxNotificationB.notifiedAt) {
    return -1;
  }

  // notifiedAt times are the same, compare readAt times if both are not null
  if (inboxNotificationA.readAt && inboxNotificationB.readAt) {
    return inboxNotificationA.readAt > inboxNotificationB.readAt
      ? 1
      : inboxNotificationA.readAt < inboxNotificationB.readAt
        ? -1
        : 0;
  } else if (inboxNotificationA.readAt || inboxNotificationB.readAt) {
    return inboxNotificationA.readAt ? 1 : -1;
  }

  // If all dates are equal, return 0
  return 0;
}

/** @internal Exported for unit tests only. */
export function applyUpsertComment<M extends BaseMetadata>(
  thread: ThreadDataWithDeleteInfo<M>,
  comment: CommentData
): ThreadDataWithDeleteInfo<M> {
  // If the thread has been deleted, we do not apply the update
  if (thread.deletedAt !== undefined) {
    return thread;
  }

  // Validate that the comment belongs to the thread
  if (comment.threadId !== thread.id) {
    console.warn(
      `Comment ${comment.id} does not belong to thread ${thread.id}`
    );
    return thread;
  }

  const existingComment = thread.comments.find(
    (existingComment) => existingComment.id === comment.id
  );

  // If the comment doesn't exist in the thread, add the comment
  if (existingComment === undefined) {
    const updatedAt = new Date(
      Math.max(thread.updatedAt?.getTime() || 0, comment.createdAt.getTime())
    );

    const updatedThread = {
      ...thread,
      updatedAt,
      comments: [...thread.comments, comment],
    };

    return updatedThread;
  }

  // If the comment exists in the thread and has been deleted, do not apply the update
  if (existingComment.deletedAt !== undefined) {
    return thread;
  }

  // Proceed to update the comment if:
  // 1. The existing comment has not been edited
  // 2. The incoming comment has not been edited (i.e. it's a new comment)
  // 3. The incoming comment has been edited more recently than the existing comment
  if (
    existingComment.editedAt === undefined ||
    comment.editedAt === undefined ||
    existingComment.editedAt <= comment.editedAt
  ) {
    const updatedComments = thread.comments.map((existingComment) =>
      existingComment.id === comment.id ? comment : existingComment
    );

    const updatedThread = {
      ...thread,
      updatedAt: new Date(
        Math.max(
          thread.updatedAt?.getTime() || 0,
          comment.editedAt?.getTime() || comment.createdAt.getTime()
        )
      ),
      comments: updatedComments,
    };
    return updatedThread;
  }

  return thread;
}

/** @internal Exported for unit tests only. */
export function applyDeleteComment<M extends BaseMetadata>(
  thread: ThreadDataWithDeleteInfo<M>,
  commentId: string,
  deletedAt: Date
): ThreadDataWithDeleteInfo<M> {
  // If the thread has been deleted, we do not delete the comment
  if (thread.deletedAt !== undefined) {
    return thread;
  }

  const existingComment = thread.comments.find(
    (comment) => comment.id === commentId
  );

  // If the comment doesn't exist in the thread, we cannot perform the deletion
  if (existingComment === undefined) {
    return thread;
  }

  // If the comment has been deleted since the deletion request, we do not delete the comment
  if (existingComment.deletedAt !== undefined) {
    return thread;
  }

  const updatedComments = thread.comments.map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          deletedAt,
          // We optimistically remove the comment body and attachments when marking it as deleted
          body: undefined,
          attachments: [],
        }
      : comment
  );

  // If all comments have been deleted (or there are no comments in the first
  // place), we mark the thread as deleted.
  if (updatedComments.every((comment) => comment.deletedAt !== undefined)) {
    return {
      ...thread,
      deletedAt,
      updatedAt: deletedAt,
    };
  }

  return {
    ...thread,
    updatedAt: deletedAt,
    comments: updatedComments,
  };
}

/** @internal Exported for unit tests only. */
export function applyAddReaction<M extends BaseMetadata>(
  thread: ThreadDataWithDeleteInfo<M>,
  commentId: string,
  reaction: CommentUserReaction
): ThreadDataWithDeleteInfo<M> {
  // If the thread has been deleted, we do not add the reaction
  if (thread.deletedAt !== undefined) {
    return thread;
  }

  const existingComment = thread.comments.find(
    (comment) => comment.id === commentId
  );

  // If the comment doesn't exist in the thread, we do not add the reaction
  if (existingComment === undefined) {
    return thread;
  }

  // If the comment has been deleted since the reaction addition request, we do not add the reaction
  if (existingComment.deletedAt !== undefined) {
    return thread;
  }

  const updatedComments = thread.comments.map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          reactions: upsertReaction(comment.reactions, reaction),
        }
      : comment
  );

  return {
    ...thread,
    updatedAt: new Date(
      Math.max(reaction.createdAt.getTime(), thread.updatedAt?.getTime() || 0)
    ),
    comments: updatedComments,
  };
}

/** @internal Exported for unit tests only. */
export function applyRemoveReaction<M extends BaseMetadata>(
  thread: ThreadDataWithDeleteInfo<M>,
  commentId: string,
  emoji: string,
  userId: string,
  removedAt: Date
): ThreadDataWithDeleteInfo<M> {
  // If the thread has been deleted, we do not remove the reaction
  if (thread.deletedAt !== undefined) {
    return thread;
  }

  const existingComment = thread.comments.find(
    (comment) => comment.id === commentId
  );

  // If the comment doesn't exist in the thread, we do not remove the reaction
  if (existingComment === undefined) {
    return thread;
  }

  // If the comment has been deleted since the reaction removal request, we do not remove the reaction
  if (existingComment.deletedAt !== undefined) {
    return thread;
  }

  const updatedComments = thread.comments.map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          reactions: comment.reactions
            .map((reaction) =>
              reaction.emoji === emoji
                ? {
                    ...reaction,
                    users: reaction.users.filter((user) => user.id !== userId),
                  }
                : reaction
            )
            .filter((reaction) => reaction.users.length > 0), // Remove reactions with no users left
        }
      : comment
  );

  return {
    ...thread,
    updatedAt: new Date(
      Math.max(removedAt.getTime(), thread.updatedAt?.getTime() || 0)
    ),
    comments: updatedComments,
  };
}

function upsertReaction(
  reactions: CommentReaction[],
  reaction: CommentUserReaction
): CommentReaction[] {
  const existingReaction = reactions.find(
    (existingReaction) => existingReaction.emoji === reaction.emoji
  );

  // If the reaction doesn't exist in the comment, we add it
  if (existingReaction === undefined) {
    return [
      ...reactions,
      {
        emoji: reaction.emoji,
        createdAt: reaction.createdAt,
        users: [{ id: reaction.userId }],
      },
    ];
  }

  // If the reaction exists in the comment, we add the user to the reaction if they are not already in it
  if (
    existingReaction.users.some((user) => user.id === reaction.userId) === false
  ) {
    return reactions.map((existingReaction) =>
      existingReaction.emoji === reaction.emoji
        ? {
            ...existingReaction,
            users: [...existingReaction.users, { id: reaction.userId }],
          }
        : existingReaction
    );
  }

  return reactions;
}
