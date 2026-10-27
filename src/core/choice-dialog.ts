export type DialogChoice = { label: string; value: string; kind?: string };

/** Resolves on close, including Escape, backdrop and a host closing the dialog without choosing. */
export function askChoices(text: string, choices: readonly DialogChoice[], dismiss: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "msg choice-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-label", text);
    const box = document.createElement("div");
    box.className = "msg-box";
    const message = document.createElement("p");
    message.className = "msg-text";
    message.textContent = text;
    const row = document.createElement("div");
    row.className = "msg-actions";
    let answer = dismiss;
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = choice.kind ?? "";
      button.textContent = choice.label;
      button.onclick = () => { answer = choice.value; dialog.close(); };
      row.append(button);
    }
    box.append(message, row);
    dialog.append(box);
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) { event.preventDefault(); dialog.close(); }
    });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(answer); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export const CHOICE_DIALOG_CSS = `
dialog.choice-dialog{max-height:calc(100vh - 2rem);max-height:calc(100dvh - 2rem);overflow:auto}
.choice-dialog .msg-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.533rem}
.choice-dialog .msg-actions button{min-width:0;min-height:2.533rem;white-space:normal;overflow-wrap:anywhere}
.choice-dialog .msg-actions button:last-child:nth-child(odd){grid-column:1/-1}
.choice-dialog .msg-actions .discard{margin-right:0}
@media(max-width:30rem){.choice-dialog .msg-actions{grid-template-columns:minmax(0,1fr)}}
`;
