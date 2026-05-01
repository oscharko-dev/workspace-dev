const toOccurrenceCount = (content, regex) => {
  return content.match(regex)?.length ?? 0;
};

export const maskCommentAndStringLiterals = (content) => {
  let index = 0;
  let state = "normal";
  let masked = "";

  while (index < content.length) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (state === "normal") {
      if (char === "'" || char === "\"" || char === "`") {
        state = char === "'" ? "single" : char === "\"" ? "double" : "template";
        masked += " ";
        index += 1;
        continue;
      }

      if (char === "/" && nextChar === "/") {
        state = "line-comment";
        masked += "  ";
        index += 2;
        continue;
      }

      if (char === "/" && nextChar === "*") {
        state = "block-comment";
        masked += "  ";
        index += 2;
        continue;
      }

      masked += char;
      index += 1;
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n") {
        state = "normal";
        masked += "\n";
      } else if (char === "\r") {
        masked += "\r";
      } else {
        masked += " ";
      }
      index += 1;
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && nextChar === "/") {
        masked += "  ";
        index += 2;
        state = "normal";
        continue;
      }
      if (char === "\n") {
        masked += "\n";
      } else if (char === "\r") {
        masked += "\r";
      } else {
        masked += " ";
      }
      index += 1;
      continue;
    }

    if (char === "\\") {
      masked += " ";
      if (index + 1 < content.length) {
        const escaped = content[index + 1];
        masked += escaped === "\n" ? "\n" : escaped === "\r" ? "\r" : " ";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    const closingQuote = state === "single" ? "'" : state === "double" ? "\"" : "`";
    if (char === closingQuote) {
      state = "normal";
      masked += " ";
      index += 1;
      continue;
    }

    if (char === "\n") {
      masked += "\n";
    } else if (char === "\r") {
      masked += "\r";
    } else {
      masked += " ";
    }
    index += 1;
  }

  return masked;
};

export const runA11yChecks = (relativePath, content) => {
  const findings = [];
  const sanitizedContent = maskCommentAndStringLiterals(content);
  const addFinding = (rule, occurrences) => {
    if (occurrences <= 0) {
      return;
    }
    findings.push({
      file: relativePath,
      rule,
      occurrences
    });
  };

  addFinding("IconButton requires aria-label", toOccurrenceCount(sanitizedContent, /<IconButton(?=[\s/>])(?![^>]*aria-label=)[^>]*>/g));
  addFinding("img requires alt", toOccurrenceCount(sanitizedContent, /<img(?=[\s/>])(?![^>]*\salt=)[^>]*>/g));
  addFinding(
    "form controls require aria-label or aria-labelledby",
    toOccurrenceCount(sanitizedContent, /<(?:input|select|textarea)(?=[\s/>])(?![^>]*(?:aria-label|aria-labelledby)=)[^>]*>/g)
  );

  return findings;
};

export const runInteractionChecks = (relativePath, content) => {
  const findings = [];
  const sanitizedContent = maskCommentAndStringLiterals(content);
  const addFinding = (rule, occurrences) => {
    if (occurrences <= 0) {
      return;
    }
    findings.push({
      file: relativePath,
      rule,
      occurrences
    });
  };

  addFinding("button requires explicit type", toOccurrenceCount(sanitizedContent, /<button(?=[\s/>])(?![^>]*\btype=)[^>]*>/g));
  addFinding("anchor requires href", toOccurrenceCount(sanitizedContent, /<a(?=[\s/>])(?![^>]*\bhref=)[^>]*>/g));
  addFinding(
    "clickable non-semantic element needs keyboard support",
    toOccurrenceCount(sanitizedContent, /<(?:div|span)(?=[\s/>])(?=[^>]*onClick=)(?![^>]*(?:onKeyDown|onKeyUp|onKeyPress|role=|tabIndex=))[^>]*>/g)
  );

  return findings;
};
