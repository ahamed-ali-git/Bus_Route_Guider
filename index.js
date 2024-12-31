import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Set up __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const saltRounds = 10;
env.config();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});
db.connect();

// Redirect to home or register page
app.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("home");
  } else {
    res.redirect("/register");
  }
});

// View routes
app.get("/login", (req, res) => res.render("login"));
app.get("/register", (req, res) => res.render("register"));
app.get("/home", (req, res) => res.render("home"));
app.get("/logout", (req, res) => res.render("logout"));

// Google OAuth2 authentication routes
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/home",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);

app.post(
  "/api/login",
  passport.authenticate("local", {
    failureRedirect: "/login", // Redirect on failure
  }),
  (req, res) => {
    // Send JSON response on successful login
    res.json({ success: true, message: "Login successful" });
  }
);

app.post("/api/signup", async (req, res) => {
  const { fullName, email, password } = req.body;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    if (checkResult.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    await db.query("INSERT INTO users (full_name, email, password) VALUES ($1, $2, $3)", [
      fullName,
      email,
      hashedPassword,
    ]);

    res.status(201).json({ success: true, message: "Account created successfully" });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Error creating account" });
  }
});

// Render logout confirmation page
app.get("/logout.ejs", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }
  res.render("logout");
});

// Handle logout action
app.post("/api/logout", (req, res) => {
  // Check if user is authenticated
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  // Perform logout
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ message: "Error during logout" });
    }

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destruction error:", err);
        return res.status(500).json({ message: "Error destroying session" });
      }

      // Clear cookie
      res.clearCookie("connect.sid");

      // Send success response
      res.status(200).json({ message: "Logout successful" });
    });
  });
});

// Middleware to check authentication
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

// Passport Local Strategy for login
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [username]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password);
        return done(null, isValid ? user : false);
      } else {
        return done(null, false);
      }
    } catch (err) {
      console.error("Error during authentication:", err);
      done(err);
    }
  })
);

// Google OAuth2 strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/home",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [profile.email]);
        if (result.rows.length === 0) {
          const newUser = await db.query("INSERT INTO users (email, password) VALUES ($1, $2)", [
            profile.email,
            "google",
          ]);
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Server listening
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

export default app;