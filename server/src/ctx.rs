//! What every command and background job reaches the rest of the server through: the data folder,
//! the database, the event relay, the coach and the long-running jobs. It replaces the Tauri
//! `AppHandle` the backend used to live in, with the same small surface (`state::<T>()`,
//! `path().app_data_dir()`), so the modules read as they did.

use std::convert::Infallible;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use crate::auth::Login;
use crate::db::Db;
use crate::mcp::Mcp;
use crate::puzzles::Import;
use crate::relay::Relay;
use crate::remote::Remote;
use crate::Coach;

pub struct Inner {
    pub data_dir: PathBuf,
    pub db: Db,
    pub relay: Relay,
    pub coach: Coach,
    pub login: Login,
    pub import: Import,
    pub remote: Remote,
    /// Set right after start: the MCP server needs a `Ctx` of its own to forward tool calls.
    pub mcp: OnceLock<Mcp>,
}

#[derive(Clone)]
pub struct Ctx(pub(crate) Arc<Inner>);

/// Kept under the name the modules were written against.
pub type AppHandle = Ctx;

impl Ctx {
    pub fn new(inner: Inner) -> Self {
        Self(Arc::new(inner))
    }

    pub fn state<T: Managed>(&self) -> State<'_, T> {
        State(T::get(&self.0))
    }

    pub fn path(&self) -> Paths<'_> {
        Paths(&self.0.data_dir)
    }

    pub fn data_dir(&self) -> &Path {
        &self.0.data_dir
    }
}

pub struct Paths<'a>(&'a Path);

impl Paths<'_> {
    pub fn app_data_dir(&self) -> Result<PathBuf, Infallible> {
        Ok(self.0.to_path_buf())
    }
}

/// A borrowed piece of the server's state, as command functions take it.
pub struct State<'a, T>(&'a T);

impl<T> Clone for State<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for State<'_, T> {}

impl<T> Deref for State<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.0
    }
}

pub trait Managed {
    fn get(inner: &Inner) -> &Self;
}

macro_rules! managed {
    ($($t:ty => $f:ident),* $(,)?) => {
        $(impl Managed for $t { fn get(inner: &Inner) -> &Self { &inner.$f } })*
    };
}
managed!(Db => db, Relay => relay, Coach => coach, Login => login, Import => import, Remote => remote);

impl Managed for Mcp {
    fn get(inner: &Inner) -> &Self {
        inner.mcp.get().expect("the MCP server starts before anything uses it")
    }
}
