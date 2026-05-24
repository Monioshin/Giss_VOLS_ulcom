function guardHandler(fn) {
  return (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out != null && typeof out.then === "function") {
        out.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

function installRouteSafety(app) {
  for (const verb of ["get", "post", "put", "patch", "delete"]) {
    const orig = app[verb].bind(app);
    app[verb] = (path, ...handlers) =>
      orig(
        path,
        ...handlers.map((h) =>
          typeof h === "function" && h.length <= 3 ? guardHandler(h) : h,
        ),
      );
  }
}

module.exports = { installRouteSafety, guardHandler };
