import os, json, datetime as dt
from flask import Flask, request, jsonify, send_from_directory, g, session
from flask_cors import CORS
from dotenv import load_dotenv

# ---------- Paths / Env ----------
BASE_DIR   = os.path.abspath(os.path.dirname(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
load_dotenv(os.path.join(BASE_DIR, ".env"))  # loads DATABASE_URL, SECRET_KEY, OPENAI_API_KEY, PORT

# ---------- Flask App ----------
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/")
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-change-me")
CORS(app)

# ---------- DB (SQLAlchemy) ----------
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, text
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, scoped_session
from sqlalchemy.exc import IntegrityError

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'app.db')}")
engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, autocommit=False))
Base = declarative_base()

# ---------- Models ----------
class Device(Base):
    __tablename__ = "devices"
    id = Column(Integer, primary_key=True)
    device_id = Column(String(64), unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    saves = relationship("SavedRecipe", back_populates="device")

class Recipe(Base):
    __tablename__ = "recipes"
    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    desc = Column(Text, nullable=False)
    time = Column(Integer, default=20)
    serves = Column(Integer, default=2)
    level = Column(String(16), default="Easy")
    img = Column(String(512), default="")
    signature = Column(String(191), unique=True, index=True)   # 191 works on MySQL 5.7+
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    saves = relationship("SavedRecipe", back_populates="recipe")

class SavedRecipe(Base):
    __tablename__ = "saved_recipes"
    id = Column(Integer, primary_key=True)
    device_id_fk = Column(Integer, ForeignKey("devices.id"), nullable=False)
    recipe_id_fk = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)
    device = relationship("Device", back_populates="saves")
    recipe = relationship("Recipe", back_populates="saves")
    __table_args__ = (UniqueConstraint("device_id_fk", "recipe_id_fk", name="uix_device_recipe"),)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(120))
    email = Column(String(191), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow)

Base.metadata.create_all(engine)

# ---------- Request-scoped Session ----------
@app.before_request
def _create_session():
    g.db = SessionLocal()

@app.teardown_appcontext
def _remove_session(exc):
    SessionLocal.remove()

# ---------- OpenAI (optional) ----------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = None
if OPENAI_API_KEY:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        client = None

# ---------- Helpers ----------
def _ensure_device(device_id: str):
    if not device_id: return None
    d = g.db.query(Device).filter_by(device_id=device_id).first()
    if not d:
        d = Device(device_id=device_id)
        g.db.add(d); g.db.commit(); g.db.refresh(d)
    return d

def _signature_of(r: dict) -> str:
    title = (r.get("title") or "").strip().lower()
    desc  = (r.get("desc") or "").strip().lower()
    img   = (r.get("img") or "").strip().lower()
    return f"{title}|{desc}|{img}"[:191]

def demo_recipes(ings):
    base = ", ".join(ings[:3]) or "simple pantry items"
    pics = [
        "https://placehold.co/800x500?text=Recipe+Photo",
        "https://placehold.co/800x500?text=Tasty+Dish",
        "https://placehold.co/800x500?text=Yum",
    ]
    return [
        {"title":"Quick Skillet Bowl","desc":f"One-pan weeknight bowl using {base}.",
         "time":22,"serves":3,"level":"Easy","img":pics[0]},
        {"title":"Creamy Pasta Toss","desc":f"Comforting pasta with {base}.",
         "time":28,"serves":2,"level":"Easy","img":pics[1]},
        {"title":"Veggie Stir-Fry","desc":f"Colorful stir-fry built around {base}.",
         "time":18,"serves":2,"level":"Medium","img":pics[2]},
    ]

# ---------- Static / Health ----------
@app.get("/")
def root():
    return send_from_directory(STATIC_DIR, "index.html")

@app.get("/health/db")
def health_db():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/__routes")
def list_routes():
    return {"routes": [f"{sorted(r.methods)} {r.rule}" for r in app.url_map.iter_rules()]}

# ---------- API: Suggest ----------
@app.post("/api/suggest")
def suggest():
    data = request.get_json(silent=True) or {}
    ingredients = [s.strip() for s in data.get("ingredients", []) if isinstance(s, str) and s.strip()]
    if not ingredients:
        return jsonify({"error": "No ingredients provided."}), 400

    if not client:
        return jsonify({"recipes": demo_recipes(ingredients)})

    prompt = (
        "You are a cooking assistant. Suggest exactly 3 simple, distinct recipes that use as many of "
        f"these ingredients as possible: {', '.join(ingredients)}. "
        'Return ONLY valid JSON with shape {"recipes":[{"title":"...","desc":"...","time":25,'
        '"serves":3,"level":"Easy","img":"https://..."}]} .'
        "Keep titles short; times 15-40; serves 2-4; level Easy/Medium; use placeholder images if needed."
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role":"user","content":prompt}],
            response_format={"type":"json_object"},
            temperature=0.7,
        )
        content = resp.choices[0].message.content
        payload = json.loads(content)
        recipes = []
        for r in (payload.get("recipes") or [])[:3]:
            recipes.append({
                "title": (r.get("title") or "Tasty Dish")[:200],
                "desc": r.get("desc") or "A quick, pantry-friendly idea.",
                "time": int(r.get("time") or 20),
                "serves": int(r.get("serves") or 2),
                "level": (r.get("level") or "Easy")[:16],
                "img": r.get("img") or "https://placehold.co/800x500?text=Recipe"
            })
        while len(recipes) < 3:
            recipes.append(demo_recipes(ingredients)[len(recipes)])
        return jsonify({"recipes": recipes})
    except Exception:
        return jsonify({"recipes": demo_recipes(ingredients)})

# ---------- API: Save / History / Clear ----------
@app.post("/api/save")
def save():
    try:
        payload = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "invalid_json"}), 400

    device_id = (payload or {}).get("device_id")
    recipe_in = (payload or {}).get("recipe") or {}
    d = _ensure_device(device_id)
    if not d:
        return jsonify({"error": "missing device_id"}), 400

    r = {
        "title": (recipe_in.get("title") or "Recipe")[:200],
        "desc": recipe_in.get("desc") or "",
        "time": int(recipe_in.get("time") or 20),
        "serves": int(recipe_in.get("serves") or 2),
        "level": (recipe_in.get("level") or "Easy")[:16],
        "img": recipe_in.get("img") or "",
    }
    sig = _signature_of(r)
    db = g.db
    try:
        rec = db.query(Recipe).filter_by(signature=sig).first()
        if not rec:
            rec = Recipe(**r, signature=sig)
            db.add(rec); db.commit(); db.refresh(rec)

        link = db.query(SavedRecipe).filter_by(device_id_fk=d.id, recipe_id_fk=rec.id).first()
        if link:
            return jsonify({"saved": False, "message": "Already saved", "recipe_id": rec.id}), 200

        link = SavedRecipe(device_id_fk=d.id, recipe_id_fk=rec.id)
        db.add(link); db.commit()
        return jsonify({"saved": True, "recipe_id": rec.id}), 200

    except IntegrityError:
        db.rollback()
        return jsonify({"saved": False, "message": "Already saved"}), 200
    except Exception as e:
        db.rollback()
        app.logger.exception("save_failed")
        return jsonify({"error": "save_failed", "detail": str(e)}), 500

@app.get("/api/history")
def history():
    device_id = request.args.get("device_id")
    db = g.db
    d = db.query(Device).filter_by(device_id=device_id).first()
    if not d:
        return jsonify({"recipes": []})
    rows = (
        db.query(SavedRecipe)
          .filter(SavedRecipe.device_id_fk == d.id)
          .order_by(SavedRecipe.created_at.desc())
          .limit(50).all()
    )
    out = [{
        "id": r.recipe.id, "title": r.recipe.title, "desc": r.recipe.desc,
        "time": r.recipe.time, "serves": r.recipe.serves,
        "level": r.recipe.level, "img": r.recipe.img
    } for r in rows]
    return jsonify({"recipes": out})

@app.post("/api/clear")
def clear_saved():
    payload = request.get_json(silent=True) or {}
    device_id = payload.get("device_id")
    if not device_id: return jsonify({"deleted": 0})
    db = g.db
    d = db.query(Device).filter_by(device_id=device_id).first()
    if not d: return jsonify({"deleted": 0})
    deleted = db.query(SavedRecipe).filter_by(device_id_fk=d.id).delete()
    db.commit()
    return jsonify({"deleted": deleted})

# ---------- Auth ----------
from werkzeug.security import generate_password_hash, check_password_hash

def current_user():
    uid = session.get("uid")
    return g.db.query(User).get(uid) if uid else None

@app.post("/auth/signup")
def auth_signup():
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({"ok": False, "error": "invalid_json"}), 400
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"ok": False, "error": "missing_fields"}), 400
    db = g.db
    if db.query(User).filter_by(email=email).first():
        return jsonify({"ok": False, "error": "email_exists"}), 409
    user = User(name=name[:120], email=email, password_hash=generate_password_hash(password))
    db.add(user); db.commit(); db.refresh(user)
    session["uid"] = user.id
    return jsonify({"ok": True, "user": {"id": user.id, "name": user.name, "email": user.email}})

@app.post("/auth/login")
def auth_login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    user = g.db.query(User).filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"ok": False, "error": "invalid_credentials"}), 401
    session["uid"] = user.id
    return jsonify({"ok": True, "user": {"id": user.id, "name": user.name, "email": user.email}})

@app.post("/auth/logout")
def auth_logout():
    session.pop("uid", None)
    return jsonify({"ok": True})

@app.get("/auth/me")
def auth_me():
    u = current_user()
    return (jsonify({"ok": True, "user": {"id": u.id, "name": u.name, "email": u.email}}) 
            if u else jsonify({"ok": False}))

# ---------- Run ----------
if __name__ == "__main__":
    print(">>> BASE_DIR:", BASE_DIR)
    print(">>> STATIC_DIR exists:", os.path.exists(STATIC_DIR))
    print(">>> index.html present:", os.path.exists(os.path.join(STATIC_DIR, "index.html")))
    print(">>> DATABASE_URL:", DATABASE_URL)
    port = int(os.getenv("PORT", "5000"))
    app.run(debug=False, host="0.0.0.0", port=port)
