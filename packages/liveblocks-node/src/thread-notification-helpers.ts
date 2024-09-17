import type {
  BaseUserMeta,
  CommentBodyJson,
  CommentData,
  CommentDataWithBody,
  DRI,
  DU,
  InboxNotificationData,
  OptionalPromise,
  ResolveUsersArgs,
} from "@liveblocks/core";
import {
  filterCommentsWithBody,
  generateCommentUrl,
  getMentionedIdsFromCommentBody,
  transformCommentBody,
} from "@liveblocks/core";

import type { Liveblocks } from "./client";
import type { ThreadNotificationEvent } from "./webhooks";

export type ThreadNotificationUnreadRepliesData = {
  type: "unreadReplies";
  comments: CommentDataWithBody[];
};

export type ThreadNotificationUnreadMentionData = {
  type: "unreadMention";
  comments: CommentDataWithBody[];
};

export type ThreadNotificationData =
  | ThreadNotificationUnreadRepliesData
  | ThreadNotificationUnreadMentionData;

/** @internal */
export const getUnreadComments = ({
  comments,
  inboxNotification,
  userId,
}: {
  comments: CommentData[];
  inboxNotification: InboxNotificationData;
  userId: string;
}): CommentDataWithBody[] => {
  const commentsWithBody = filterCommentsWithBody(comments);
  const readAt = inboxNotification.readAt;

  return commentsWithBody
    .filter((c) => c.userId !== userId)
    .filter((c) =>
      readAt
        ? c.createdAt > readAt && c.createdAt <= inboxNotification.notifiedAt
        : c.createdAt <= inboxNotification.notifiedAt
    );
};

/** @internal */
export const getLastCommentWithMention = ({
  comments,
  mentionedUserId,
}: {
  comments: CommentDataWithBody[];
  mentionedUserId: string;
}): CommentDataWithBody | null => {
  return (
    Array.from(comments)
      .reverse()
      .filter((c) => c.userId !== mentionedUserId)
      .find((c) => {
        const mentionedUserIds = getMentionedIdsFromCommentBody(c.body);
        return mentionedUserIds.includes(mentionedUserId);
      }) ?? null
  );
};

/**
 * Get thread notification data helper.
 *
 * It returns either an object containing a list of unread replies for a thread
 * or either an object containing a list of the last unread comment where the notification
 * receiver was mentioned in.
 *
 * @param params.client Liveblocks node client
 * @param params.event The thread notification event
 * @returns A thread notification data object
 *
 * @example Unread replies:
 * {
 *  type: "unreadReplies",
 *  comments: [unread_comment_0, unread_comment_1, ...],
 * }
 *
 * @example Unread mention:
 * {
 *  type: "unreadMention",
 *  comments: [unread_comment_with_mention]
 * }
 */
export async function getThreadNotificationData(params: {
  client: Liveblocks;
  event: ThreadNotificationEvent;
}): Promise<ThreadNotificationData> {
  const { client, event } = params;
  const { threadId, roomId, userId, inboxNotificationId } = event.data;

  const [thread, inboxNotification] = await Promise.all([
    client.getThread({ roomId, threadId }),
    client.getInboxNotification({ inboxNotificationId, userId }),
  ]);

  const unreadComments = getUnreadComments({
    comments: thread.comments,
    inboxNotification,
    userId,
  });
  const lastUnreadCommentWithMention = getLastCommentWithMention({
    comments: unreadComments,
    mentionedUserId: userId,
  });

  if (lastUnreadCommentWithMention !== null) {
    return {
      type: "unreadMention",
      comments: [lastUnreadCommentWithMention],
    };
  }

  return {
    type: "unreadReplies",
    comments: unreadComments,
  };
}

export type ResolveRoomInfoArgs = {
  /**
   * The ID of the room to resolve
   */
  roomId: string;
};

export type GetThreadNotificationThreadNotificationResolvedOptions<
  U extends BaseUserMeta = DU,
> = {
  /**
   * Which format to transform the comment body to.
   */
  format?: "html" | "json";
  /**
   * A function that returns info from user IDs.
   */
  resolveUsers?: (
    args: ResolveUsersArgs
  ) => OptionalPromise<(U["info"] | undefined)[] | undefined>;
  /**
   * A function that returns room info from room IDs.
   */
  resolveRoomInfo?: (
    args: ResolveRoomInfoArgs
  ) => OptionalPromise<DRI | undefined>;
};

export type ResolvedCommentAuthorData = {
  id: string;
  name: string;
  avatar?: string;
};

/** @internal */
const resolveAuthorsInComments = async <U extends BaseUserMeta>({
  comments,
  resolveUsers,
}: {
  comments: CommentDataWithBody[];
  resolveUsers?: (
    args: ResolveUsersArgs
  ) => OptionalPromise<(U["info"] | undefined)[] | undefined>;
}): Promise<Map<string, U["info"]>> => {
  const resolvedAuthors = new Map<string, U["info"]>();
  if (!resolveUsers) {
    return resolvedAuthors;
  }

  const userIds = comments.map((c) => c.userId);
  const users = await resolveUsers({ userIds });

  for (const [index, userId] of userIds.entries()) {
    const user = users?.[index];
    if (user) {
      resolvedAuthors.set(userId, user);
    }
  }

  return resolvedAuthors;
};

export type ResolvedCommentData = {
  id: string;
  threadId: string;
  roomId: string;
  author: ResolvedCommentAuthorData;
  createdAt: Date;
  body: string | CommentBodyJson;
  commentUrl?: string;
};

export type UnreadRepliesData = {
  type: "unreadReplies";
  comments: ResolvedCommentData[];
};
export type UnreadMentionData = {
  type: "unreadMention";
  comments: ResolvedCommentData[];
};
export type ThreadNotificationResolvedData = (
  | UnreadRepliesData
  | UnreadMentionData
) & {
  roomInfo: DRI;
};

/**
 *
 * Get thread notification resolved data helper.
 *
 * It returns either an object containing a list of unread replies for a thread
 * or either an object containing a list of the last unread comment where the notification
 * receiver was mentioned in.
 *
 * @param params.client Liveblocks node client
 * @param params.event The thread notification event
 * @returns A thread notification resolved data object
 *
 * @example Unread replies:
 * {
 *  type: "unreadReplies",
 *  comments: [unread_comment_0, unread_comment_1, ...],
 *  roomName: "acme"
 * }
 *
 * @example Unread mention:
 * {
 *  type: "unreadMention",
 *  comments: [unread_comment_with_mention],
 *  roomName: "acme"
 * }
 */
export async function getThreadNotificationResolvedData(params: {
  client: Liveblocks;
  event: ThreadNotificationEvent;
  options?: GetThreadNotificationThreadNotificationResolvedOptions<BaseUserMeta>;
}): Promise<ThreadNotificationResolvedData> {
  const { client, event, options } = params;
  const { roomId } = event.data;

  const roomInfos = options?.resolveRoomInfo
    ? await options.resolveRoomInfo({ roomId })
    : undefined;

  const { type, comments } = await getThreadNotificationData({
    client,
    event,
  });

  const resolvedAuthors = await resolveAuthorsInComments({
    comments,
    resolveUsers: options?.resolveUsers,
  });

  const unreadComments = await Promise.all(
    comments.map(async (comment): Promise<ResolvedCommentData> => {
      const body = await transformCommentBody(comment.body, {
        format: options?.format,
        resolveUsers: options?.resolveUsers,
      });
      const resolvedAuthor = resolvedAuthors.get(comment.userId);
      const author: ResolvedCommentAuthorData = {
        id: comment.userId,
        name: resolvedAuthor?.name ?? comment.userId,
      };

      const commentUrl = roomInfos?.url
        ? generateCommentUrl({
            roomUrl: roomInfos.url,
            commentId: comment.id,
          })
        : undefined;

      return {
        id: comment.id,
        threadId: comment.threadId,
        roomId: comment.roomId,
        createdAt: comment.createdAt,
        author,
        body,
        commentUrl,
      };
    })
  );

  return {
    type,
    comments: unreadComments,
    roomInfo: {
      ...roomInfos,
      name: roomInfos?.name ?? roomId,
    },
  };
}