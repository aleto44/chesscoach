// Phone debugging: see dev_log.

/// Debug builds only: appends a device's debug log lines (the `?touchlog` log, src/touchLog.ts) to
/// `phone-debug.log` in the project folder, so phone-only bugs can be read on the computer rather
/// than from screenshots. Release builds ignore it.
#[tauri::command]
pub fn dev_log(device: String, lines: Vec<String>) {
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("phone-debug.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let now = chrono_now();
            for line in lines {
                let _ = writeln!(f, "{now} [{device}] {line}");
            }
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = (device, lines);
}

/// Wall-clock time for the debug log, without a date crate.
#[cfg(debug_assertions)]
fn chrono_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{:02}:{:02}:{:02}Z", secs / 3600 % 24, secs / 60 % 60, secs % 60)
}
