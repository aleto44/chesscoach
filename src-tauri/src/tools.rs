//! Tool definitions advertised to the coach. The handlers live in the frontend
//! (`src/coach/tools.ts`); keep the names and argument shapes in sync.

use serde_json::{json, Value};

pub fn definitions() -> Value {
    json!([
        {
            "name": "get_state",
            "description": "Get what the student is looking at: the main game (FEN, SAN move list, side to move), \
                the tangent board currently open (if any) with its line and the ply being viewed, \
                and the current mode and focus.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "analyze",
            "description": "Run Stockfish on a position. Returns the top lines with evaluations from White's point \
                of view (pawns, or mate in N) and the principal variation in SAN. You must call this before \
                stating any evaluation or claiming a move is best, good, bad, winning or losing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fen": { "type": "string", "description": "FEN to analyze. Defaults to the position on the student's screen." },
                    "multipv": { "type": "integer", "minimum": 1, "maximum": 5, "default": 3 },
                    "depth": { "type": "integer", "minimum": 8, "maximum": 22, "default": 16 }
                }
            }
        },
        {
            "name": "show_line",
            "description": "Show the student a line of moves on its own board (a tangent card they can step through). \
                Every move is checked for legality; if any move is illegal you get an error naming it and nothing \
                is shown, so fix the line and call again. Use this for every concrete line of two or more moves \
                instead of writing the moves in prose.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short title for the breadcrumb, e.g. \"Why not ...Nf6?\"" },
                    "start_fen": { "type": "string", "description": "Position the line starts from. Defaults to the position on the student's screen." },
                    "moves": { "type": "array", "items": { "type": "string" }, "description": "Moves in SAN, e.g. [\"e5\", \"Nf3\", \"Nc6\"]. No move numbers." },
                    "notes": { "type": "array", "items": { "type": "string" }, "description": "Optional comment shown after each move, same order as moves. Use \"\" for no comment." }
                },
                "required": ["title", "moves"]
            }
        },
        {
            "name": "setup_position",
            "description": "Put a position on the student's board as a side board (tangent), for example to                 show a typical structure or set up a question. It opens right away; the student can move pieces                 on it to try ideas. Use show_line instead when you have concrete moves to show.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short breadcrumb title, e.g. \"Carlsbad structure\"" },
                    "fen": { "type": "string", "description": "The position. Must be legal (both kings, side to move not giving check)." },
                    "note": { "type": "string", "description": "Optional one-line caption under the board." }
                },
                "required": ["title", "fen"]
            }
        },
        {
            "name": "draw_arrows",
            "description": "Draw arrows and circles on the position the student is looking at (they stay until                 the position changes). Good for pointing at a plan, a weak square or a piece's route without                 writing coordinates. Colors: green (good/plan), red (threat/bad), blue (alternative), yellow                 (attention). Pass empty lists to clear.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "arrows": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "from": { "type": "string" }, "to": { "type": "string" },
                                "color": { "type": "string", "enum": ["green", "red", "blue", "yellow"] }
                            },
                            "required": ["from", "to"]
                        }
                    },
                    "circles": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "square": { "type": "string" },
                                "color": { "type": "string", "enum": ["green", "red", "blue", "yellow"] }
                            },
                            "required": ["square"]
                        }
                    }
                }
            }
        },
        {
            "name": "ask_move",
            "description": "Quiz the student: put a position on their board and wait for them to play a move \
                there. The app grades it (any move in `accept`, or within `tolerance_cp` of Stockfish's best) and \
                returns what they played, whether it was right, the engine's best move and evaluations. Misses are \
                saved as drills. Ask about real decisions (a plan, a tactic, the key move of an opening), not \
                trivia. Don't reveal the answer in your message before calling.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "The question, e.g. \"White to play. How do you meet the threat on f7?\"" },
                    "title": { "type": "string", "description": "Short breadcrumb title, e.g. \"Quiz: the c5 break\"" },
                    "fen": { "type": "string", "description": "The position. Defaults to the one on the student's screen." },
                    "accept": { "type": "array", "items": { "type": "string" }, "description": "SAN moves that count as right regardless of the engine, e.g. book moves." },
                    "tolerance_cp": { "type": "integer", "minimum": 0, "maximum": 200, "default": 30 }
                },
                "required": ["prompt"]
            }
        },
        {
            "name": "book_lookup",
            "description": "The app's opening book: the name of the opening on the student's board, the book                 continuations from here, and what the student's own repertoire plays. Cheaper and more reliable                 than recalling theory. Only works for lines from the normal starting position.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "moves": { "type": "array", "items": { "type": "string" }, "description": "SAN from the start position. Defaults to the moves on the student's board." }
                }
            }
        },
        {
            "name": "get_profile",
            "description": "The student's profile, built from their RATED games (played with no engine, coach or                 takebacks): record by color, average loss and mistake counts by game phase, the most common                 mistake patterns, results by opening, recent games, your earlier observations, and drill stats.                 Practice games are only counted. Call it before judging the student's level or picking what                 to work on.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "query_games",
            "description": "List the student's games with their analyzed mistakes and blunders (move, the engine's                 best move, the swing, pattern tags, clock). Rated games by default. Engine numbers here are                 already computed: no need to re-run analyze on them.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["rated", "practice", "all"], "default": "rated" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 },
                    "game_id": { "type": "integer", "description": "Just this game (includes the FEN before each mistake)." }
                }
            }
        },
        {
            "name": "record_observation",
            "description": "Save a short note about the student's play for future sessions, e.g. tag \"endgames\",                 note \"Doesn't activate the king in rook endings\". Use it when you notice a pattern, not for                 one-off slips. Notes show up in get_profile.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tag": { "type": "string", "description": "One or two words, e.g. \"tactics\", \"time management\"." },
                    "note": { "type": "string" },
                    "fen": { "type": "string", "description": "An example position, if there is one." }
                },
                "required": ["tag", "note"]
            }
        }
    ])
}
