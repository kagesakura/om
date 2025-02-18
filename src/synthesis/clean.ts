import { rulesExtended } from "discord-markdown-parser";
import type { Guild, Message } from "discord.js";
import SimpleMarkdown from "simple-markdown";
import type { SingleASTNode, ASTNode, Capture } from "simple-markdown";

const parser = SimpleMarkdown.parserFor(
  {
    ...rulesExtended,
    command: {
      order: rulesExtended.strong.order,
      match: (source: string) =>
        /^<\/([\w-]+(?: [\w-]+)?(?: [\w-]+)?):(\d{17,20})>/.exec(source),
      parse: (capture: Capture) => ({
        name: capture[1],
        id: capture[2],
        type: "command",
      }),
    },
    channelOrMessageLink: {
      order: rulesExtended.url.order - 0.5,
      match: (source: string) => {
        const matched =
          /^https:\/\/(?:(?:canary\.|ptb\.)?discord(?:app)?.com|staging\.discord\.co)\/channels\/(\d+|@me)(?:\/(\d+|[a-zA-Z-]+))?(?:\/(\d+|[a-zA-Z-]+))?/.exec(
            source,
          );
        if (matched?.[2]?.match(/\D/) || matched?.[3]?.match(/\D/)) return null;
        return matched;
      },
      parse: (capture: Capture) => ({
        guildIdOrMe: capture[1],
        channelId: capture[2],
        messageId: capture[3],
        type: "channelOrMessageLink",
      }),
    },
    attachmentLink: {
      order: rulesExtended.url.order - 0.5,
      match: (source: string) =>
        /^https:\/\/(?:(?:media|images)\.discordapp\.net|cdn\.discordapp\.com)\/(?:attachments|ephemeral-attachments)\/\d+\/\d+\/([\w.-]*[\w-])(?:\?[\w?&=-]*)?/.exec(
          source,
        ),
      parse: (capture: Capture) => ({
        filename: capture[1],
        type: "attachmentLink",
      }),
    },
    mediaPostLink: {
      order: rulesExtended.url.order - 0.5,
      match: (source: string) =>
        /^https:\/\/(?:(?:canary\.|ptb\.)?discord(?:app)?.com|staging\.discord\.co)\/channels\/(\d+)\/(\d+)\/threads\/(\d+)\/(\d+)/.exec(
          source,
        ),
      parse: (capture: Capture) => ({
        guildId: capture[1],
        channelId: capture[2],
        threadId: capture[3],
        messageId: capture[4],
        type: "mediaPostLink",
      }),
    },
  },
  { inline: true },
);

export function cleanMarkdown(message: Message) {
  const ast = parser(message.content);
  return text(ast, message.guild);
}

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "full",
  timeStyle: "full",
});

function text(ast: ASTNode, guild: Guild | null): string {
  if (Array.isArray(ast)) {
    return ast.map((node) => text(node, guild)).join("");
  }

  switch (ast.type) {
    case "link":
    case "blockQuote":
    case "em":
    case "strong":
    case "underline":
    case "strikethrough":
      return text(astNodeOrEmpty(ast.content), guild);

    case "text":
    case "escape":
    case "inlineCode":
      return stringOrEmpty(ast.content);

    case "url":
    case "autolink":
      return " URL省略 ";

    case "spoiler":
      return " 伏字 ";

    case "newline":
    case "br":
      return "\n";

    case "codeBlock": {
      const lang = stringOrEmpty(ast.lang);
      return lang ? ` ${lang}のコード ` : " コード ";
    }

    case "user": {
      const id = stringOrEmpty(ast.id);
      const member = guild?.members.cache.get(id);
      return member ? cleanTwemojis(member.displayName) : " 不明なユーザー ";
    }
    case "channel": {
      const id = stringOrEmpty(ast.id);
      const channel = guild?.channels.cache.get(id);
      return channel ? cleanTwemojis(channel.name) : " 不明なチャンネル ";
    }
    case "role": {
      const id = stringOrEmpty(ast.id);
      const role = guild?.roles.cache.get(id);
      return role ? cleanTwemojis(role.name) : " 不明なロール ";
    }
    case "emoji": {
      return stringOrEmpty(ast.name);
    }
    case "command": {
      const name = stringOrEmpty(ast.name);
      return ` ${name}コマンド `;
    }
    case "everyone": {
      return " @エブリワン ";
    }
    case "here": {
      return " @ヒア ";
    }
    case "twemoji": {
      // TODO: proper text to read aloud
      return stringOrEmpty(ast.name);
    }
    case "timestamp": {
      const timestamp = stringOrEmpty(ast.timestamp);
      const date = Number(timestamp) * 1000;
      if (!Number.isInteger(date) || Math.abs(date) > 8640000000000000)
        return " 不明な日付 ";

      const full = dateSegments(date);
      const now = dateSegments(Date.now());
      // read only different segments from now
      for (let i = 0; i < full.length; i++) {
        if (full[i] !== now[i]) return full.slice(i).join("");
      }

      return "今";
    }

    case "attachmentLink":
      return stringOrEmpty(ast.filename);

    case "mediaPostLink":
      return " メディアポスト ";

    case "channelOrMessageLink": {
      if (!ast.channelId) {
        return " URL省略 ";
      }

      if (guild?.id !== stringOrEmpty(ast.guildIdOrMe)) {
        return ` 外部サーバーの${ast.messageId ? "メッセージ" : "チャンネル"} `;
      }

      const channel = guild.channels.cache.get(stringOrEmpty(ast.channelId));
      if (!channel) {
        return ` 不明な${ast.messageId ? "メッセージ" : "チャンネル"} `;
      }

      const name = cleanTwemojis(channel.name);
      if (ast.messageId) {
        return `${name}のメッセージ`;
      } else {
        return name;
      }
    }
  }

  return "";
}

function astNodeOrEmpty(ast: unknown): ASTNode {
  if (Array.isArray(ast)) {
    return ast.every(isSingleASTNode) ? ast : [];
  } else {
    return isSingleASTNode(ast) ? ast : [];
  }
}

function isSingleASTNode(ast: unknown): ast is SingleASTNode {
  return (
    typeof ast === "object" &&
    ast !== null &&
    "type" in ast &&
    typeof ast.type === "string"
  );
}

function stringOrEmpty(str: unknown): string {
  return typeof str === "string" ? str : "";
}

const twemojiParser = SimpleMarkdown.parserFor(
  { twemoji: rulesExtended.twemoji, text: rulesExtended.text },
  { inline: true },
);

function cleanTwemojis(s: string) {
  const ast = twemojiParser(s);
  return text(ast, null); // should be only twemoji and text, so no problem with null
}

function dateSegments(date: number | Date) {
  const segments = dateTimeFormat
    .formatToParts(date)
    .reduce<string[]>((accumulator, { type, value }) => {
      switch (type) {
        case "year":
        case "month":
        case "day":
        case "hour":
        case "minute":
        case "second": {
          // remove leading 0
          const val = +value;
          accumulator.push(Number.isNaN(val) ? value : `${val}`);
          break;
        }
        case "weekday":
        case "literal":
          if (accumulator.length === 0) {
            accumulator.push(value);
          } else {
            // string-concatenatation
            accumulator[accumulator.length - 1] += value;
          }
          break;
      }
      return accumulator;
    }, []);
  segments[segments.length - 1] = segments[segments.length - 1].trimEnd();
  return segments;
}
