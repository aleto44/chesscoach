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
            "description": "Run Stockfish on a position. Returns the top lines, each with its evaluation in words \
                (\"White +1.20\", \"Black mates in 3\"), the principal variation in SAN and what it comes to in \
                material, then the position's computed facts. You must call this (or use numbers the app already \
                gave you) before stating any evaluation or claiming a move is best, good, bad, winning or losing.",
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
            "name": "evaluate_moves",
            "description": "Judge up to 4 candidate moves in a position against the engine: the eval before and \
                after each, its verdict on chess.com's scale (best, good, inaccuracy, mistake, blunder), the \
                winning chances it gives away, and what happens next (the opponent's best reply played out to \
                where the material settles, with a note per move), plus the engine's better move and what it \
                does. Use it for \"why not X?\", \"is X good?\", \"X or Y?\" and before saying what a move wins, \
                loses or allows.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fen": { "type": "string", "description": "The position. Defaults to the one on the student's screen." },
                    "moves": { "type": "array", "items": { "type": "string" }, "description": "Moves in SAN for the side to move, e.g. [\"Nxe5\", \"d4\"]." },
                    "depth": { "type": "integer", "minimum": 10, "maximum": 20, "default": 14 }
                },
                "required": ["moves"]
            }
        },
        {
            "name": "position_facts",
            "description": "Facts about a position computed exactly by code: material, loose (attacked and \
                undefended) pieces, pins, captures that win material, checks, mate in one, what the other side \
                threatens, kings and pawn shields, passed / isolated / doubled pawns, undeveloped pieces, open \
                files. The <screen> block already has them for the position on screen; call this for another \
                position before describing it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fen": { "type": "string", "description": "Defaults to the position on the student's screen." }
                }
            }
        },
        {
            "name": "show_line",
            "description": "Make a scenario: a line of moves on its own board, with your arrows and circles on \
                it, that the student steps through. Every move is checked for legality; if any move is illegal \
                you get an error naming it and nothing is shown, so fix the line and call again. The result \
                has the engine's verdict on every move (eval before and after, mistake or not, the engine's \
                move when it differs) and lists the mistakes in the line: make what you say match it. Use this for \
                every concrete line of two or more moves instead of writing the moves in prose. Returns the \
                scenario's key (s1, s2, ...): link to it in your reply as [words](#s1), and the student taps \
                those words to open it on the board.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short title for the breadcrumb, e.g. \"Why not ...Nf6?\"" },
                    "start_fen": { "type": "string", "description": "Position the line starts from. Defaults to the position on the student's screen." },
                    "moves": { "type": "array", "items": { "type": "string" }, "description": "Moves in SAN, e.g. [\"e5\", \"Nf3\", \"Nc6\"]. No move numbers." },
                    "notes": { "type": "array", "items": { "type": "string" }, "description": "Optional comment shown after each move, same order as moves. Use \"\" for no comment." },
                    "arrows": {
                        "type": "array",
                        "description": "Arrows to draw on this board. `at` is how many of the line's moves have been played when the arrow shows: 0 (the default) is the starting position, 3 is after the third move.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "from": { "type": "string" }, "to": { "type": "string" },
                                "color": { "type": "string", "enum": ["green", "red", "blue", "yellow"] },
                                "at": { "type": "integer", "minimum": 0 }
                            },
                            "required": ["from", "to"]
                        }
                    },
                    "circles": {
                        "type": "array",
                        "description": "Squares to circle, with `at` as for arrows.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "square": { "type": "string" },
                                "color": { "type": "string", "enum": ["green", "red", "blue", "yellow"] },
                                "at": { "type": "integer", "minimum": 0 }
                            },
                            "required": ["square"]
                        }
                    },
                    "side": { "type": "string", "enum": ["white", "black"], "description": "Whose point of view the board shows (that side at the bottom): the student's side in the position you're talking about, e.g. black for a game or puzzle they had as Black. Defaults to the side at the bottom of the student's board now." },
                    "ply": { "type": "integer", "minimum": 0, "description": "Which step it opens on: how many moves are played. Default 0, the starting position." },
                    "open": { "type": "boolean", "description": "Open it on the student's board right away. Default false (they open it from the chat). Open the one your reply is mainly about." }
                },
                "required": ["title", "moves"]
            }
        },
        {
            "name": "setup_position",
            "description": "Make a scenario from a position: its own board, with your arrows and circles, for                 example to show a typical structure, a plan or a weakness. It opens right away unless open is                 false; the student can move pieces on it to try ideas. Use show_line instead when you have                 concrete moves to show. Returns its key; link to it in your reply as [words](#s1).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Short breadcrumb title, e.g. \"Carlsbad structure\"" },
                    "fen": { "type": "string", "description": "The position. Must be legal (both kings, side to move not giving check)." },
                    "note": { "type": "string", "description": "Optional one-line caption under the board." },
                    "side": { "type": "string", "enum": ["white", "black"], "description": "Whose point of view the board shows (that side at the bottom): the student's side in the position you're talking about, e.g. black for a game or puzzle they had as Black. Defaults to the side at the bottom of the student's board now." },
                    "arrows": {
                        "type": "array",
                        "description": "Arrows to draw on this board. `at` is how many of the line's moves have been played when the arrow shows: 0 (the default) is the starting position, 3 is after the third move.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "from": { "type": "string" }, "to": { "type": "string" },
                                "color": { "type": "string", "enum": ["green", "red", "blue", "yellow"] },
                                "at": { "type": "integer", "minimum": 0 }
                            },
                            "required": ["from", "to"]
                        }
                    },
                    "circles": {
                        "type": "array",
                        "description": "Squares to circle, with `at` as for arrows.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "square": { "type": "string" },
                                "color": { "type": "string", "enum": ["green", "red", "blue", "yellow"] },
                                "at": { "type": "integer", "minimum": 0 }
                            },
                            "required": ["square"]
                        }
                    },
                    "open": { "type": "boolean", "description": "Default true." }
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
            "name": "find_puzzles",
            "description": "Give the student a set of Lichess puzzles to solve: real-game tactics, rated by millions \
                of attempts and tagged by theme. They open in the app's puzzle trainer, which grades them; this \
                returns right away with what was queued. Results show up later in get_profile (puzzle rating, \
                accuracy by theme). Use it to target a weakness (\"you missed two pins this week\") or the \
                tactics of an opening the student is learning. Themes are Lichess's: fork, pin, skewer, \
                discoveredAttack, hangingPiece, trappedPiece, deflection, attraction, sacrifice, quietMove, \
                defensiveMove, backRankMate, mateIn1, mateIn2, mateIn3, kingsideAttack, exposedKing, \
                rookEndgame, pawnEndgame, endgame, middlegame, opening, ...",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "themes": { "type": "array", "items": { "type": "string" }, "description": "Any of these Lichess themes. Empty = any." },
                    "opening": { "type": "string", "description": "Only puzzles from games in this opening, e.g. \"Caro-Kann Defense\" or \"Caro-Kann Defense: Advance Variation\"." },
                    "rating_min": { "type": "integer", "description": "Puzzle rating on the chess.com scale, like every rating the student sees (the app converts it). Defaults to around the student's puzzle rating." },
                    "rating_max": { "type": "integer" },
                    "count": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 },
                    "title": { "type": "string", "description": "Shown above the set, e.g. \"Pins\"" }
                }
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
