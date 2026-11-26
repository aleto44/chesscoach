//! `chesscoach-server [--data DIR] [--port 8765] [--web DIST]` runs the server.
//! `chesscoach-server backup DEST.db [--data DIR]` writes a consistent copy of the database (for the
//! server's daily snapshot), safe while the server runs.
//! `chesscoach-server pairing-code [--data DIR]` prints the code a new device pairs with.

use std::path::PathBuf;

fn usage() -> ! {
    eprintln!("usage: chesscoach-server [--data DIR] [--port N] [--web DIST] | backup DEST.db | pairing-code");
    std::process::exit(2)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mut cmd: Option<String> = None;
    let mut dest: Option<PathBuf> = None;
    let mut data = std::env::var_os("CHESSCOACH_DATA").map(PathBuf::from).unwrap_or_else(|| "data".into());
    let mut port: u16 = std::env::var("CHESSCOACH_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8765);
    let mut web = std::env::var_os("CHESSCOACH_WEB").map(PathBuf::from);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--data" => data = args.next().unwrap_or_else(|| usage()).into(),
            "--port" => port = args.next().and_then(|p| p.parse().ok()).unwrap_or_else(|| usage()),
            "--web" => web = Some(args.next().unwrap_or_else(|| usage()).into()),
            "backup" if cmd.is_none() => {
                cmd = Some(a);
                dest = Some(args.next().unwrap_or_else(|| usage()).into());
            }
            "pairing-code" if cmd.is_none() => cmd = Some(a),
            _ => usage(),
        }
    }
    match cmd.as_deref() {
        Some("backup") => match chesscoach_server::db::backup(&data.join("chesscoach.db"), &dest.unwrap()) {
            Ok(()) => {}
            Err(e) => {
                eprintln!("backup failed: {e}");
                std::process::exit(1);
            }
        },
        Some("pairing-code") => println!("{}", chesscoach_server::remote::Remote::load(&data, None).code()),
        _ => {
            let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
            let result = rt.block_on(async move {
                let ctx = chesscoach_server::start(data, web).await?;
                chesscoach_server::remote::serve(ctx, port).await
            });
            if let Err(e) = result {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
    }
}
