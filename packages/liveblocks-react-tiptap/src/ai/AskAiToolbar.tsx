import {
  autoUpdate,
  type DetectOverflowOptions,
  flip,
  hide,
  inline,
  limitShift,
  offset,
  shift,
  size,
  useFloating,
  type UseFloatingOptions,
} from "@floating-ui/react-dom";
import { TooltipProvider, useRefs } from "@liveblocks/react-ui/_private";
import { type Editor, useEditorState } from "@tiptap/react";
import type {
  ComponentProps,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import React, {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";

import { classNames } from "../classnames";
import { EditorProvider } from "../context";
import type { AiExtensionStorage, FloatingPosition } from "../types";
import { compareTextSelections, getDomRangeFromTextSelection } from "../utils";

export interface AskAiToolbarProps
  extends Omit<ComponentProps<"div">, "children"> {
  editor: Editor | null;
  position?: FloatingPosition;
  offset?: number;
}

export const ASK_AI_TOOLBAR_COLLISION_PADDING = 10;

export const AskAiToolbar = forwardRef<HTMLDivElement, AskAiToolbarProps>(
  (
    {
      position = "bottom",
      offset: sideOffset = 6,
      editor,
      onKeyDown,
      className,
      ...props
    },
    forwardedRef
  ) => {
    const askAiSelection =
      useEditorState({
        editor,
        selector: (ctx) => {
          return (
            ctx.editor?.storage.liveblocksAi as AiExtensionStorage | undefined
          )?.askAiSelection;
        },
        equalityFn: compareTextSelections,
      }) ?? undefined;
    const floatingOptions: UseFloatingOptions = useMemo(() => {
      const detectOverflowOptions: DetectOverflowOptions = {
        padding: ASK_AI_TOOLBAR_COLLISION_PADDING,
      };

      return {
        strategy: "fixed",
        placement: position,
        middleware: [
          inline(detectOverflowOptions),
          flip({ ...detectOverflowOptions, crossAxis: false }),
          hide(detectOverflowOptions),
          shift({
            ...detectOverflowOptions,
            limiter: limitShift(),
          }),
          offset(sideOffset),
          size(detectOverflowOptions),
        ],
        whileElementsMounted: (...args) => {
          return autoUpdate(...args, {
            animationFrame: true,
          });
        },
      };
    }, [position, sideOffset]);
    const isOpen = askAiSelection !== undefined;
    const {
      refs: { setReference, setFloating },
      strategy,
      x,
      y,
      isPositioned,
    } = useFloating({
      ...floatingOptions,
      open: isOpen,
    });
    const mergedRefs = useRefs(forwardedRef, setFloating);

    useLayoutEffect(() => {
      if (!editor || !isOpen) {
        return;
      }

      if (!askAiSelection) {
        setReference(null);
      } else {
        const domRange = getDomRangeFromTextSelection(askAiSelection, editor);

        setReference(domRange);
      }
    }, [askAiSelection, editor, isOpen, setReference]);

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && editor) {
          editor.commands.focus();
        }
        onKeyDown?.(event);
      },
      [editor, onKeyDown]
    );

    if (!editor || !isOpen) {
      return null;
    }

    return createPortal(
      <TooltipProvider>
        <EditorProvider editor={editor}>
          <div
            role="toolbar"
            aria-label="Ask AI toolbar"
            aria-orientation="horizontal"
            className={classNames(
              "lb-root lb-portal lb-elevation lb-tiptap-floating",
              className
            )}
            ref={mergedRefs}
            style={{
              position: strategy,
              top: 0,
              left: 0,
              transform: isPositioned
                ? `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
                : "translate3d(0, -200%, 0)",
              minWidth: "max-content",
            }}
            {...props}
            onKeyDown={handleKeyDown}
          >
            Hello world
          </div>
        </EditorProvider>
      </TooltipProvider>,
      document.body
    );
  }
);