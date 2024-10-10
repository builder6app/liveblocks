"use client";

import { RoomProvider, useThreads } from "@liveblocks/react/suspense";
import { Loading } from "../../components/Loading";
import { Composer, Thread } from "@liveblocks/react-ui";
import { ClientSideSuspense } from "@liveblocks/react";
import { ErrorBoundary } from "react-error-boundary";
import { useExampleRoomId } from "../../example.client";
import { Suspense, useState } from "react";

/**
 * Displays a list of threads, along with a composer for creating
 * new threads.
 */

function Example({
  resolved,
  color,
}: {
  resolved?: boolean;
  color?: "red" | "blue" | "*";
}) {
  const metadata: { color?: "blue" | "red" } = {};
  if (color !== "*") {
    metadata.color = color;
  }

  const { threads, fetchMore, isFetchingMore, fetchMoreError, hasFetchedAll } =
    useThreads({
      query: { resolved, metadata },
    });

  return (
    <div className="threads">
      {threads.map((thread) => (
        <Thread
          key={thread.id}
          thread={thread}
          className="thread"
          style={{ border: `2px solid ${thread.metadata.color}` }}
        />
      ))}

      {fetchMoreError && (
        <div className="error">
          😞 Failed to get more: ${fetchMoreError.message}
        </div>
      )}

      {/* A button to load more threads which is disabled while fetching new threads and hidden when there is nothing more to fetch */}
      {!hasFetchedAll && (
        <button
          onClick={fetchMore}
          disabled={isFetchingMore}
          className="button primary"
        >
          {isFetchingMore ? "…" : "Load more"}
        </button>
      )}

      <Composer
        className="composer"
        metadata={{
          color:
            color !== "*"
              ? color
              : ["red", "blue", undefined][Math.floor(Math.random() * 3)],
        }}
      />
    </div>
  );
}

function Room({ room }: { room: string }) {
  const roomId = useExampleRoomId(room);
  const [resolved, setResolved] = useState<boolean | undefined>(false);
  const [color, setColor] = useState<"red" | "blue" | undefined | "*">("*");
  return (
    <RoomProvider id={roomId}>
      <div>
        <button
          disabled={resolved === undefined}
          onClick={() => setResolved(undefined)}
        >
          All
        </button>
        <button disabled={resolved === true} onClick={() => setResolved(true)}>
          Resolved
        </button>
        <button
          disabled={resolved === false}
          onClick={() => setResolved(false)}
        >
          Unresolved
        </button>
      </div>
      <div>
        <button disabled={color === "*"} onClick={() => setColor("*")}>
          Any
        </button>
        <button
          disabled={color === undefined}
          onClick={() => setColor(undefined)}
        >
          Without color
        </button>
        <button disabled={color === "red"} onClick={() => setColor("red")}>
          Red
        </button>
        <button disabled={color === "blue"} onClick={() => setColor("blue")}>
          Blue
        </button>
      </div>
      <ErrorBoundary
        fallback={
          <div className="error">There was an error while getting threads.</div>
        }
      >
        <ClientSideSuspense fallback={<Loading />}>
          <Example resolved={resolved} color={color} />
        </ClientSideSuspense>
      </ErrorBoundary>
    </RoomProvider>
  );
}

export default function Page({ params }: { params: { room: string } }) {
  return (
    <Suspense fallback={<Loading />}>
      <Room room={params.room} />
    </Suspense>
  );
}
