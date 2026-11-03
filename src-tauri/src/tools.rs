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
        }
    ])
}
