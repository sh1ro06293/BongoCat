#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    io::{self, Write},
};

fn handle_ssh_askpass() -> bool {
    if env::var_os("BONGOCAT_SSH_ASKPASS_MODE").is_none() {
        return false;
    }

    let password = match env::var("BONGOCAT_SSH_PASSWORD") {
        Ok(password) => password,
        Err(_) => std::process::exit(1),
    };
    let mut stdout = io::stdout().lock();

    if stdout.write_all(password.as_bytes()).is_err()
        || stdout.write_all(b"\n").is_err()
        || stdout.flush().is_err()
    {
        std::process::exit(1);
    }

    true
}

fn main() {
    if handle_ssh_askpass() {
        return;
    }

    bongo_cat_lib::run()
}
