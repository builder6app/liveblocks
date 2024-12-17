import {
  autoUpdate,
  type DetectOverflowOptions,
  hide,
  type Middleware,
  offset,
  useFloating,
  type UseFloatingOptions,
} from "@floating-ui/react-dom";
import {
  Button,
  CheckIcon,
  CrossIcon,
  EditIcon,
  LengthenIcon,
  QuestionMarkIcon,
  SendIcon,
  ShortcutTooltip,
  ShortenIcon,
  SparklesIcon,
  TooltipProvider,
  TranslateIcon,
  UndoIcon,
  useRefs,
} from "@liveblocks/react-ui/_private";
import { type Editor, useEditorState } from "@tiptap/react";
import { Command, useCommandState } from "cmdk";
import type {
  ChangeEvent,
  ComponentProps,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";

import { classNames } from "../classnames";
import { EditorProvider, useCurrentEditor } from "../context";
import type {
  AiCommands,
  AiToolbarExtensionStorage,
  ExtendedChainedCommands,
  FloatingPosition,
} from "../types";
import { compareTextSelections, getDomRangeFromTextSelection } from "../utils";

export const AI_TOOLBAR_COLLISION_PADDING = 10;

export interface AiToolbarProps
  extends Omit<ComponentProps<"div">, "value" | "defaultValue"> {
  editor: Editor | null;
  position?: FloatingPosition;
  offset?: number;
}

interface AiToolbarDropdownGroupProps extends ComponentProps<"div"> {
  label: string;
}

interface AiToolbarDropdownCustomItemProps
  extends ComponentProps<typeof Command.Item> {
  icon?: ReactNode;
}

interface AiToolbarDropdownItemProps extends ComponentProps<"div"> {
  prompt?: string;
  icon?: ReactNode;
}

/**
 * A custom Floating UI middleware to position/scale the toolbar:
 * - Vertically: relative to the reference (e.g. selection)
 * - Horizontally: relative to the editor
 * - Width: relative to the editor
 */
function tiptapFloating(editor: Editor | null): Middleware {
  return {
    name: "tiptap",
    options: editor,
    fn({ elements }) {
      if (!editor) {
        return {};
      }

      const editorRect = editor.view.dom.getBoundingClientRect();

      elements.floating.style.setProperty(
        "--lb-tiptap-editor-width",
        `${editorRect.width}px`
      );
      elements.floating.style.setProperty(
        "--lb-tiptap-editor-height",
        `${editorRect.height}px`
      );

      return {
        x: editorRect.x,
      };
    },
  };
}

const AiToolbarDropdownGroup = forwardRef<
  HTMLDivElement,
  AiToolbarDropdownGroupProps
>(({ children, label, ...props }, forwardedRef) => {
  return (
    <Command.Group
      heading={<span className="lb-dropdown-label">{label}</span>}
      {...props}
      ref={forwardedRef}
    >
      {children}
    </Command.Group>
  );
});

const AiToolbarDropdownCustomItem = forwardRef<
  HTMLDivElement,
  AiToolbarDropdownCustomItemProps
>(({ children, onSelect, icon, ...props }, forwardedRef) => {
  return (
    <Command.Item
      className="lb-dropdown-item"
      onSelect={onSelect}
      {...props}
      ref={forwardedRef}
    >
      {icon ? <span className="lb-icon-container">{icon}</span> : null}
      {children ? (
        <span className="lb-dropdown-item-label">{children}</span>
      ) : null}
    </Command.Item>
  );
});

const AiToolbarDropdownItem = forwardRef<
  HTMLDivElement,
  AiToolbarDropdownItemProps
>(({ prompt: manualPrompt, ...props }, forwardedRef) => {
  const editor = useCurrentEditor("DropdownItem", "AiToolbar");

  const handleSelect = useCallback(
    (prompt: string) => {
      editor.commands.askAi(manualPrompt ?? prompt);
    },
    [editor, manualPrompt]
  );

  return (
    <AiToolbarDropdownCustomItem
      {...props}
      onSelect={handleSelect}
      ref={forwardedRef}
    />
  );
});

// TODO: Rename
function AiToolbarPromptTextArea({
  editor,
  prompt,
  dropdownRef,
  isDropdownHidden,
}: {
  editor: Editor;
  prompt: string;
  dropdownRef: RefObject<HTMLDivElement>;
  isDropdownHidden: boolean;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const isPromptEmpty = useMemo(() => prompt.trim() === "", [prompt]);

  useLayoutEffect(
    () => {
      setTimeout(() => {
        const promptTextArea = promptRef.current;

        if (!promptTextArea) {
          return;
        }

        promptTextArea.focus();
        promptTextArea.setSelectionRange(
          promptTextArea.value.length,
          promptTextArea.value.length
        );
      }, 0);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePromptKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        // If the shift key is pressed, add a new line
        (editor.commands as AiCommands<boolean>).setAiPrompt(
          (prompt) => prompt + "\n"
        );
      } else {
        const selectedDropdownItem = dropdownRef.current?.querySelector(
          "[role='option'][data-selected='true']"
        ) as HTMLElement | null;

        if (!isDropdownHidden && selectedDropdownItem) {
          // If there's a selected dropdown item, select it
          selectedDropdownItem.click();
        } else if (!isPromptEmpty) {
          // Otherwise, submit the custom prompt
          (editor.commands as AiCommands<boolean>).askAi(prompt);
        }
      }
    }
  };

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      (editor.commands as AiCommands<boolean>).setAiPrompt(event.target.value);
    },
    [editor]
  );

  const handleSendClick = useCallback(() => {
    if (isPromptEmpty) {
      return;
    }

    (editor.commands as AiCommands<boolean>).askAi(prompt);
  }, [editor, prompt, isPromptEmpty]);

  return (
    <div className="lb-tiptap-ai-toolbar-content">
      <span className="lb-icon-container lb-tiptap-ai-toolbar-icon-container">
        <SparklesIcon />
      </span>
      <div
        className="lb-tiptap-ai-toolbar-prompt-container"
        data-value={prompt}
      >
        <Command.Input asChild>
          <textarea
            ref={promptRef}
            className="lb-tiptap-ai-toolbar-prompt"
            placeholder="Ask AI anything…"
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handlePromptKeyDown}
            rows={1}
            autoFocus
          />
        </Command.Input>
      </div>
      <div className="lb-tiptap-ai-toolbar-actions">
        <ShortcutTooltip content="Ask AI" shortcut="Enter">
          <Button
            className="lb-tiptap-ai-toolbar-action"
            variant="primary"
            aria-label="Ask AI"
            icon={<SendIcon />}
            disabled={isPromptEmpty}
            onClick={handleSendClick}
          />
        </ShortcutTooltip>
      </div>
    </div>
  );
}

function AiToolbarAsking({
  editor,
  children,
}: {
  editor: Editor;
  children?: ReactNode;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasDropdownItems = useCommandState(
    (state) => state.filtered.count > 0
  ) as boolean;
  const prompt =
    useEditorState({
      editor,
      selector: (ctx) => {
        return (
          ctx.editor?.storage.liveblocksAiToolbar as
            | AiToolbarExtensionStorage
            | undefined
        )?.prompt;
      },
      equalityFn: Object.is,
    }) ?? "";
  const isPromptMultiline = useMemo(() => prompt.includes("\n"), [prompt]);
  const isDropdownHidden = isPromptMultiline || !hasDropdownItems;

  return (
    <>
      <div className="lb-elevation lb-tiptap-ai-toolbar">
        <AiToolbarPromptTextArea
          editor={editor}
          dropdownRef={dropdownRef}
          prompt={prompt}
          isDropdownHidden={isDropdownHidden}
        />
      </div>
      <div
        className="lb-elevation lb-dropdown lb-tiptap-ai-toolbar-dropdown"
        data-hidden={isDropdownHidden ? "" : undefined}
      >
        <Command.List ref={dropdownRef}>{children}</Command.List>
      </div>
    </>
  );
}

function AiToolbarThinking({ editor }: { editor: Editor }) {
  const prompt =
    useEditorState({
      editor,
      selector: (ctx) => {
        return (
          ctx.editor?.storage.liveblocksAiToolbar as
            | AiToolbarExtensionStorage
            | undefined
        )?.prompt;
      },
      equalityFn: Object.is,
    }) ?? "";

  // TODO: On error, go back to asking state (with error message, cancelAskAi(error))
  // TODO: On success, go to reviewing state (and pass the prompt to previousPrompt)

  useEffect(() => {
    setTimeout(() => {
      (editor.commands as AiCommands<boolean>).reviewAi();
    }, 50000);
  }, [editor]);

  const handleCancel = useCallback(() => {
    (editor.commands as AiCommands<boolean>).cancelAskAi();
  }, [editor]);

  return (
    <>
      <div className="lb-elevation lb-tiptap-ai-toolbar">
        <div className="lb-tiptap-ai-toolbar-content">
          <span className="lb-icon-container lb-tiptap-ai-toolbar-icon-container">
            <SparklesIcon />
          </span>
          <span className="lb-tiptap-ai-toolbar-loading">
            Thinking about {prompt}
          </span>
          <div className="lb-tiptap-ai-toolbar-actions">
            <ShortcutTooltip content="Cancel">
              <Button
                className="lb-tiptap-ai-toolbar-action"
                variant="primary"
                aria-label="Cancel"
                icon={<UndoIcon />}
                onClick={handleCancel}
              />
            </ShortcutTooltip>
          </div>
        </div>
      </div>
      <div className="lb-tiptap-ai-toolbar-halo" />
    </>
  );
}

function AiToolbarReviewing({ editor }: { editor: Editor }) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasDropdownItems = useCommandState(
    (state) => state.filtered.count > 0
  ) as boolean;
  const prompt =
    useEditorState({
      editor,
      selector: (ctx) => {
        return (
          ctx.editor?.storage.liveblocksAiToolbar as
            | AiToolbarExtensionStorage
            | undefined
        )?.prompt;
      },
      equalityFn: Object.is,
    }) ?? "";
  const isPromptMultiline = useMemo(() => prompt.includes("\n"), [prompt]);
  const isDropdownHidden = isPromptMultiline || !hasDropdownItems;

  const handleRetry = useCallback(() => {
    (editor.commands as AiCommands<boolean>).retryAskAi();
  }, [editor]);

  const handleDiscard = useCallback(() => {
    (editor.commands as AiCommands<boolean>).closeAi();
  }, [editor]);

  return (
    <>
      <div className="lb-elevation lb-tiptap-ai-toolbar">
        <div className="lb-tiptap-ai-toolbar-output">Output</div>
        <AiToolbarPromptTextArea
          editor={editor}
          dropdownRef={dropdownRef}
          prompt={prompt}
          isDropdownHidden={isDropdownHidden}
        />
      </div>
      <div
        className="lb-elevation lb-dropdown lb-tiptap-ai-toolbar-dropdown"
        data-hidden={isDropdownHidden ? "" : undefined}
      >
        <Command.List ref={dropdownRef}>
          <AiToolbarDropdownCustomItem icon={<CheckIcon />}>
            Replace selection
          </AiToolbarDropdownCustomItem>
          <AiToolbarDropdownCustomItem icon={<CheckIcon />}>
            Insert below
          </AiToolbarDropdownCustomItem>
          <AiToolbarDropdownCustomItem
            icon={<UndoIcon />}
            onSelect={handleRetry}
          >
            Try again
          </AiToolbarDropdownCustomItem>
          <AiToolbarDropdownCustomItem
            icon={<CrossIcon />}
            onSelect={handleDiscard}
          >
            Discard
          </AiToolbarDropdownCustomItem>
        </Command.List>
      </div>
    </>
  );
}

const defaultDropdownItems = (
  <>
    <AiToolbarDropdownGroup label="Generate">
      <AiToolbarDropdownItem icon={<EditIcon />}>
        Improve writing
      </AiToolbarDropdownItem>
      <AiToolbarDropdownItem icon={<CheckIcon />}>
        Fix mistakes
      </AiToolbarDropdownItem>
      <AiToolbarDropdownItem icon={<ShortenIcon />}>
        Simplify the text
      </AiToolbarDropdownItem>
      <AiToolbarDropdownItem icon={<LengthenIcon />}>
        Add more detail
      </AiToolbarDropdownItem>
    </AiToolbarDropdownGroup>
    <AiToolbarDropdownGroup label="Modify selection">
      <AiToolbarDropdownItem icon={<TranslateIcon />}>
        Translate to English
      </AiToolbarDropdownItem>
      <AiToolbarDropdownItem icon={<QuestionMarkIcon />}>
        Explain
      </AiToolbarDropdownItem>
    </AiToolbarDropdownGroup>
  </>
);

export const AiToolbar = Object.assign(
  forwardRef<HTMLDivElement, AiToolbarProps>(
    (
      {
        position = "bottom",
        offset: sideOffset = 6,
        editor,
        className,
        children = defaultDropdownItems,
        ...props
      },
      forwardedRef
    ) => {
      const state =
        useEditorState({
          editor,
          selector: (ctx) => {
            return (
              ctx.editor?.storage.liveblocksAiToolbar as
                | AiToolbarExtensionStorage
                | undefined
            )?.state;
          },
          equalityFn: Object.is,
        }) ?? "closed";
      const selection =
        useEditorState({
          editor,
          selector: (ctx) => {
            return (
              ctx.editor?.storage.liveblocksAiToolbar as
                | AiToolbarExtensionStorage
                | undefined
            )?.selection;
          },
          equalityFn: compareTextSelections,
        }) ?? undefined;
      const floatingOptions: UseFloatingOptions = useMemo(() => {
        const detectOverflowOptions: DetectOverflowOptions = {
          padding: AI_TOOLBAR_COLLISION_PADDING,
        };

        return {
          strategy: "fixed",
          placement: position,
          middleware: [
            tiptapFloating(editor),
            hide(detectOverflowOptions),
            offset(sideOffset),
          ],
          whileElementsMounted: (...args) => {
            return autoUpdate(...args, {
              animationFrame: true,
            });
          },
        };
      }, [editor, position, sideOffset]);
      const isOpen = selection !== undefined;
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
      const toolbarRef = useRef<HTMLDivElement>(null);
      const mergedRefs = useRefs(forwardedRef, toolbarRef, setFloating);

      useEffect(() => {
        if (editor && !selection && state !== "closed") {
          (editor.commands as AiCommands<boolean>).closeAi();
        }
      }, [state, selection, editor]);

      useLayoutEffect(() => {
        if (!editor || !isOpen) {
          return;
        }

        setReference(null);

        setTimeout(() => {
          if (!selection) {
            setReference(null);
          } else {
            const domRange = getDomRangeFromTextSelection(selection, editor);

            setReference(domRange);
          }
        }, 0);
      }, [selection, editor, isOpen, setReference]);

      useEffect(() => {
        if (!editor || !isOpen) {
          return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
          if (!event.defaultPrevented && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();

            (editor.chain() as ExtendedChainedCommands<"closeAi">)
              .closeAi()
              .focus()
              .run();
          }
        };

        document.addEventListener("keydown", handleKeyDown);

        return () => {
          document.removeEventListener("keydown", handleKeyDown);
        };
      }, [editor, isOpen]);

      if (!editor || !isOpen) {
        return null;
      }

      return createPortal(
        <TooltipProvider>
          <EditorProvider editor={editor}>
            <Command
              key={state}
              role="toolbar"
              label="AI toolbar"
              aria-orientation="horizontal"
              className={classNames(
                "lb-root lb-portal lb-tiptap-ai-toolbar-container",
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
              }}
              {...props}
            >
              {state === "asking" ? (
                <AiToolbarAsking editor={editor} children={children} />
              ) : state === "thinking" ? (
                <AiToolbarThinking editor={editor} />
              ) : state === "reviewing" ? (
                <AiToolbarReviewing editor={editor} />
              ) : null}
            </Command>
          </EditorProvider>
        </TooltipProvider>,
        document.body
      );
    }
  ),
  {
    DropdownGroup: AiToolbarDropdownGroup,
    DropdownItem: AiToolbarDropdownItem,
  }
);
