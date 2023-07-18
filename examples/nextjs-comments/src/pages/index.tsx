import React, { Suspense, useMemo } from "react";
import { useRouter } from "next/router";
import {
  Comment,
  createThread,
  deleteComment,
  useThreads,
} from "../../liveblocks.config";
import { Composer } from "@liveblocks/react-comments";
import { useHydrated } from "../utils/use-hydrated";

// function Example({ roomId }: { roomId: string }) {
//   const threads = useThreads(roomId);

//   return (
//     <main>
//       <div>
//         {threads.map((thread) => (
//           <div key={thread.id}>
//             {thread.comments
//               .filter((comment) => comment.body !== undefined)
//               .map((comment) => (
//                 <div key={comment.id}>
//                   {comment.body && <Comment.Body body={comment.body} />}
//                   <button
//                     onClick={() =>
//                       deleteComment(roomId, {
//                         commentId: comment.id,
//                         threadId: thread.id,
//                       })
//                     }
//                   >
//                     Delete
//                   </button>
//                 </div>
//               ))}
//           </div>
//         ))}
//         <Composer.Form
//           onCommentSubmit={({ body }) => {
//             createThread(roomId, { body, metadata: { resolved: false } });
//           }}
//         >
//           <Composer.Body />
//         </Composer.Form>
//       </div>
//     </main>
//   );
// }

function Example({ roomId }: { roomId: string }) {
  const threads = useThreads(roomId);

  return (
    <main>
      <div>
        {threads.map((thread) => (
          <div key={thread.id}>
            {thread.comments.map((comment) => (
              <Comment key={comment.id} comment={comment} />
            ))}
          </div>
        ))}
        <Composer.Form
          onCommentSubmit={({ body }) => {
            createThread(roomId, { body, metadata: { resolved: false } });
          }}
        >
          <Composer.Body />
          <Composer.Submit>Send</Composer.Submit>
        </Composer.Form>
      </div>
    </main>
  );
}

export default function Page() {
  // TODO: Change room ID
  const roomId = useOverrideRoomId("comments-react");
  const isHydrated = useHydrated();

  // TODO: Fix SSR
  if (!isHydrated) {
    return <Loading />;
  }

  return (
    <Suspense fallback={<Loading />}>
      <Example roomId={roomId} />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="loading">
      <img src="https://liveblocks.io/loading.svg" alt="Loading" />
    </div>
  );
}

export async function getStaticProps() {
  const API_KEY = process.env.LIVEBLOCKS_SECRET_KEY;
  const API_KEY_WARNING = process.env.CODESANDBOX_SSE
    ? `Add your secret key from https://liveblocks.io/dashboard/apikeys as the \`LIVEBLOCKS_SECRET_KEY\` secret in CodeSandbox.\n` +
      `Learn more: https://github.com/liveblocks/liveblocks/tree/main/examples/nextjs-comments#codesandbox.`
    : `Create an \`.env.local\` file and add your secret key from https://liveblocks.io/dashboard/apikeys as the \`LIVEBLOCKS_SECRET_KEY\` environment variable.\n` +
      `Learn more: https://github.com/liveblocks/liveblocks/tree/main/examples/nextjs-comments#getting-started.`;

  if (!API_KEY) {
    console.warn(API_KEY_WARNING);
  }

  return { props: {} };
}

/**
 * This function is used when deploying an example on liveblocks.io.
 * You can ignore it completely if you run the example locally.
 */
function useOverrideRoomId(roomId: string) {
  const { query } = useRouter();
  const overrideRoomId = useMemo(() => {
    return query?.roomId ? `${roomId}-${query.roomId}` : roomId;
  }, [query, roomId]);

  return overrideRoomId;
}
