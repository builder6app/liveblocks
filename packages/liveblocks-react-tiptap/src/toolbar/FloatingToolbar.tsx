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
import { type Editor, isTextSelection, useEditorState } from "@tiptap/react";
import type {
  ComponentProps,
  FocusEvent as ReactFocusEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { classNames } from "../classnames";
import { EditorProvider } from "../context";
import type { FloatingPosition } from "../types";
import {
  applyToolbarSlot,
  Toolbar,
  type ToolbarSlot,
  type ToolbarSlotProps,
} from "./Toolbar";

export interface FloatingToolbarProps
  extends Omit<ComponentProps<"div">, "children"> {
  editor: Editor | null;
  position?: FloatingPosition;
  offset?: number;
  children?: ToolbarSlot;
  leading?: ToolbarSlot;
  trailing?: ToolbarSlot;
}

export const FLOATING_TOOLBAR_COLLISION_PADDING = 10;
const FLOATING_TOOLBAR_OPEN_DELAY = 50;

function DefaultFloatingToolbarContent({ editor }: ToolbarSlotProps) {
  const supportsThread = "addPendingComment" in editor.commands;
  const supportsAi = "askAi" in editor.commands;

  return (
    <>
      {supportsAi ? (
        <>
          <Toolbar.SectionAi />
          <Toolbar.Separator />
        </>
      ) : null}
      <Toolbar.SectionInline />
      {supportsThread ? (
        <>
          <Toolbar.Separator />
          <Toolbar.SectionCollaboration />
        </>
      ) : null}
    </>
  );
}

export const FloatingToolbar = forwardRef<HTMLDivElement, FloatingToolbarProps>(
  (
    {
      children = DefaultFloatingToolbarContent,
      leading,
      trailing,
      position = "top",
      offset: sideOffset = 6,
      editor,
      onPointerDown,
      onFocus,
      onBlur,
      className,
      ...props
    },
    forwardedRef
  ) => {
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [isPointerDown, setPointerDown] = useState(false);
    const [isFocused, setFocused] = useState(false);
    const isEditable =
      useEditorState({
        editor,
        equalityFn: Object.is,
        selector: (ctx) => ctx.editor?.isEditable ?? false,
      }) ?? false;
    const hasSelectionRange =
      useEditorState({
        editor,
        equalityFn: Object.is,
        selector: (ctx) => {
          const editor = ctx.editor;

          if (!editor) {
            return false;
          }

          const { doc, selection } = editor.state;
          const { empty, ranges } = selection;
          const from = Math.min(...ranges.map((range) => range.$from.pos));
          const to = Math.max(...ranges.map((range) => range.$to.pos));

          if (empty) {
            return false;
          }

          return (
            isTextSelection(selection) && doc.textBetween(from, to).length > 0
          );
        },
      }) ?? false;

    const isOpen = isFocused && !isPointerDown && hasSelectionRange;
    const [delayedIsOpen, setDelayedIsOpen] = useState(isOpen);
    const delayedIsOpenTimeoutRef = useRef<number>();

    // Don't close when the focus moves from the editor to the toolbar
    useEffect(() => {
      if (!editor) {
        return;
      }

      const handleFocus = () => {
        setFocused(true);
      };

      const handleBlur = (event: FocusEvent) => {
        if (
          event.relatedTarget &&
          toolbarRef.current?.contains(event.relatedTarget as Node)
        ) {
          return;
        }

        if (event.relatedTarget === editor.view.dom) {
          return;
        }

        setFocused(false);
      };

      editor.view.dom.addEventListener("focus", handleFocus);
      editor.view.dom.addEventListener("blur", handleBlur);

      return () => {
        editor.view.dom.removeEventListener("focus", handleFocus);
        editor.view.dom.removeEventListener("blur", handleBlur);
      };
    }, [editor]);

    const handleFocus = useCallback(
      (event: ReactFocusEvent<HTMLDivElement>) => {
        onFocus?.(event);

        if (!event.isDefaultPrevented()) {
          setFocused(true);
        }
      },
      [onFocus]
    );

    // Close the toolbar when the it loses focus to something else than the editor
    const handleBlur = useCallback(
      (event: ReactFocusEvent<HTMLDivElement>) => {
        onBlur?.(event);

        if (!event.isDefaultPrevented()) {
          if (
            event.relatedTarget &&
            toolbarRef.current?.contains(event.relatedTarget as Node)
          ) {
            return;
          }

          if (event.relatedTarget === editor?.view.dom) {
            return;
          }

          setFocused(false);
        }
      },
      [onBlur, editor]
    );

    // Delay the opening of the toolbar to avoid flickering issues
    useEffect(() => {
      if (isOpen) {
        delayedIsOpenTimeoutRef.current = window.setTimeout(() => {
          setDelayedIsOpen(true);
        }, FLOATING_TOOLBAR_OPEN_DELAY);
      } else {
        setDelayedIsOpen(false);
      }

      return () => {
        window.clearTimeout(delayedIsOpenTimeoutRef.current);
      };
    }, [isOpen]);

    const floatingOptions: UseFloatingOptions = useMemo(() => {
      const detectOverflowOptions: DetectOverflowOptions = {
        padding: FLOATING_TOOLBAR_COLLISION_PADDING,
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
    const {
      refs: { setReference, setFloating },
      strategy,
      x,
      y,
      isPositioned,
    } = useFloating({
      ...floatingOptions,
      open: delayedIsOpen,
    });
    const mergedRefs = useRefs(forwardedRef, toolbarRef, setFloating);

    const handlePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        onPointerDown?.(event);

        event.stopPropagation();
      },
      [onPointerDown]
    );

    useEffect(() => {
      if (!editor || !isEditable) {
        return;
      }

      const handlePointerDown = () => {
        setPointerDown(true);
      };
      const handlePointerUp = () => {
        setPointerDown(false);
      };

      document.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("pointercancel", handlePointerUp);
      document.addEventListener("pointerup", handlePointerUp);

      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
        document.removeEventListener("pointercancel", handlePointerUp);
        document.removeEventListener("pointerup", handlePointerUp);
      };
    }, [editor, isEditable]);

    useLayoutEffect(() => {
      if (!editor || !delayedIsOpen) {
        return;
      }

      const updateSelectionReference = () => {
        const domSelection = window.getSelection();

        if (
          editor.state.selection.empty ||
          !domSelection ||
          !domSelection.rangeCount
        ) {
          setReference(null);
        } else {
          const domRange = domSelection.getRangeAt(0);

          setReference(domRange);
        }
      };

      editor.on("transaction", updateSelectionReference);
      updateSelectionReference();

      return () => {
        editor.off("transaction", updateSelectionReference);
      };
    }, [editor, delayedIsOpen, setReference]);

    useEffect(() => {
      if (!editor) {
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          // TODO: Close the floating toolbar
          editor.commands.focus();
        }
      };

      editor.view.dom.addEventListener("keydown", handleKeyDown);

      return () => {
        editor.view.dom.removeEventListener("keydown", handleKeyDown);
      };
    }, [editor]);

    if (!editor || !delayedIsOpen) {
      return null;
    }

    const slotProps: ToolbarSlotProps = { editor };

    return createPortal(
      <TooltipProvider>
        <EditorProvider editor={editor}>
          <div
            role="toolbar"
            aria-label="Floating toolbar"
            aria-orientation="horizontal"
            className={classNames(
              "lb-root lb-portal lb-elevation lb-tiptap-floating-toolbar lb-tiptap-toolbar",
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
            onPointerDown={handlePointerDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            {...props}
          >
            {applyToolbarSlot(leading, slotProps)}
            {applyToolbarSlot(children, slotProps)}
            {applyToolbarSlot(trailing, slotProps)}
          </div>
        </EditorProvider>
      </TooltipProvider>,
      document.body
    );
  }
);
