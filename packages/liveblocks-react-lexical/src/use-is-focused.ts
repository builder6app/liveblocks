import { mergeRegister } from "@lexical/utils";
import type { LexicalEditor } from "lexical";
import { BLUR_COMMAND, COMMAND_PRIORITY_LOW, FOCUS_COMMAND } from "lexical";
import { useLayoutEffect, useState } from "react";

export function useIsFocused(editor: LexicalEditor) {
  const [isFocused, setFocused] = useState(() => {
    return editor.getRootElement() === document.activeElement;
  });

  useLayoutEffect(() => {
    setFocused(editor.getRootElement() === document.activeElement);

    return mergeRegister(
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setFocused(true);
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          setFocused(false);
          return false;
        },
        COMMAND_PRIORITY_LOW
      )
    );
  }, [editor]);

  return isFocused;
}
