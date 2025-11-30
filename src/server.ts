import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json()); // JSON 파싱

let userCollection;
let worryLetterCollection;
let worryLetterCommentsCollection;

// app.get("/", (req, res) => {
//   res.send("서버가 정상적으로 동작 중입니다!");
// });

//자동 회원가입
app.post("/autoSignup", async (req, res) => {
  const { anonId } = req.body;
  try {
    const existingUser = await userCollection.findOne({ anonId });
    if (existingUser) {
      return res.status(200).json({ message: "이미 가입된 유저" });
    }
    await userCollection.insertOne({ anonId });
    res.status(201).json({ message: "자동 회원가입 성공" });
  } catch (error) {
    res.status(500).json({ error: "자동 회원가입 실패" });
  }
});

//글 등록
app.post("/writing", async (req, res) => {
  const { anonId, letter, writtenDate, attention, colorIndex } = req.body;

  //최근 1분 내에 같은 anonId가 글을 썼는지 검사
  const recent = await worryLetterCollection.findOne({ anonId }, { sort: { writtenDate: -1 } });
  if (recent && new Date(recent.writtenDate) > new Date(Date.now() - 60 * 1000)) {
    return res.status(429).json({ error: "너무 자주 글을 쓸 수 없습니다." });
  }

  //빈글 검사
  if (letter.trim() === "") return;

  try {
    const newWorryLetter = {
      anonId,
      letter,
      writtenDate,
      attention,
      colorIndex,
    };
    const user = await userCollection.findOne({ anonId });
    const userPoint = user ? user.point || 0 : 0;
    if (userPoint < 100 && colorIndex !== 0) {
      return res.status(403).json({ error: "색지는 100포인트가 필요합니다." });
    } else {
      if (colorIndex !== 0) {
        await userCollection.updateOne({ anonId }, { $inc: { point: -100 } }, { upsert: true });
      }
      await worryLetterCollection.insertOne(newWorryLetter);
      await userCollection.updateOne({ anonId }, { $inc: { point: 5 } }, { upsert: true });
      res.status(201).json({ message: "털어놓기 성공" });
    }
  } catch (error) {
    res.status(500).json({ error: "털어놓기에 실패했습니다. 다시 시도해주세요." });
  }
});
//글 조회
app.get("/listening", async (req, res) => {
  try {
    const letters = await worryLetterCollection.find({}).sort({ writtenDate: -1 }).toArray();
    res.status(200).json(letters);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

//댓글 등록
app.post("/worry", async (req, res) => {
  const { worryId, anonId, commentWriter, commentTxt, commentTime, likes, dislikes } = req.body;

  //빈글자 검사
  if (commentTxt.trim() === "") return;

  //레벨 가져오기
  const user = await userCollection.findOne({ anonId });
  const level = user ? user.level || 0 : 0;

  try {
    const comment = {
      worryId,
      anonId,
      commentWriter,
      commentTxt,
      commentTime,
      likes,
      dislikes,
      level,
    };
    await worryLetterCommentsCollection.insertOne(comment);
    await userCollection.updateOne({ anonId }, { $inc: { point: 2 } }, { upsert: true });
    res.status(200).json({ message: "댓글 추가 성공" });
  } catch (error) {
    res.status(500).json({ error: "댓글 추가 실패" });
  }
});
//해당 글의 댓글 조회
app.get("/worry/:worryId", async (req, res) => {
  const { worryId } = req.params;
  try {
    const comments = await worryLetterCommentsCollection.find({ worryId }).sort({ commentTime: -1 }).toArray();
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({ error: "댓글 조회 실패" });
  }
});

// 좋아요 토글
app.get("/worry/like/:commentId/:anonId", async (req, res) => {
  const { commentId, anonId } = req.params;

  try {
    const comment = await worryLetterCommentsCollection.findOne({ _id: new ObjectId(commentId) });
    const writer = comment.anonId;

    if (!comment) {
      return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });
    }

    if (comment.likes && comment.likes.includes(anonId)) {
      // 이미 좋아요를 눌렀으면 제거
      await worryLetterCommentsCollection.updateOne({ _id: new ObjectId(commentId) }, { $pull: { likes: anonId } });
      if (writer !== anonId) {
        await userCollection.updateOne({ anonId: writer }, { $inc: { point: -2 } }, { upsert: true });
      }
      res.status(200).json({ message: "좋아요 취소" });
    } else {
      // 없으면 추가
      await worryLetterCommentsCollection.updateOne({ _id: new ObjectId(commentId) }, { $addToSet: { likes: anonId } });
      if (writer !== anonId) {
        await userCollection.updateOne({ anonId: writer }, { $inc: { point: 2 } }, { upsert: true });
      }

      res.status(200).json({ message: "좋아요 처리 성공" });
    }
  } catch (error) {
    res.status(500).json({ error: "좋아요 처리 실패" });
  }
});
// 싫어요 토글
app.get("/worry/dislike/:commentId/:anonId", async (req, res) => {
  const { commentId, anonId } = req.params;
  try {
    const comment = await worryLetterCommentsCollection.findOne({ _id: new ObjectId(commentId) });
    const writer = comment.anonId;

    if (!comment) {
      return res.status(404).json({ error: "댓글을 찾을 수 없습니다." });
    }

    if (comment.dislikes && comment.dislikes.includes(anonId)) {
      // 이미 싫어요를 눌렀으면 제거
      await worryLetterCommentsCollection.updateOne({ _id: new ObjectId(commentId) }, { $pull: { dislikes: anonId } });
      if (writer !== anonId) {
        await userCollection.updateOne({ anonId: writer }, { $inc: { point: 1 } }, { upsert: true });
      }
      res.status(200).json({ message: "싫어요 취소" });
    } else {
      // 없으면 추가
      await worryLetterCommentsCollection.updateOne({ _id: new ObjectId(commentId) }, { $addToSet: { dislikes: anonId } });
      if (writer !== anonId) {
        await userCollection.updateOne({ anonId: writer }, { $inc: { point: -1 } }, { upsert: true });
      }
      res.status(200).json({ message: "싫어요 처리 성공" });
    }
  } catch (error) {
    res.status(500).json({ error: "싫어요 처리 실패" });
  }
});
// 공감 토글
app.get("/worry/:worryId/:anonId", async (req, res) => {
  const { worryId, anonId } = req.params;
  const letter = await worryLetterCollection.findOne({ _id: new ObjectId(worryId) });
  const writer = letter.anonId;

  if (letter.attention.includes(anonId)) {
    // 이미 공감한 상태이면 제거
    await worryLetterCollection.updateOne({ _id: new ObjectId(worryId) }, { $pull: { attention: anonId } });
    if (writer !== anonId) {
      await userCollection.updateOne({ anonId: writer }, { $inc: { point: -3 } }, { upsert: true });
    }
    const updatedLetter = await worryLetterCollection.findOne({ _id: new ObjectId(worryId) });
    res.status(200).json({ message: "공감 취소", attentionList: updatedLetter.attention });
  } else {
    // 공감하지 않은 상태이면 추가
    await worryLetterCollection.updateOne({ _id: new ObjectId(worryId) }, { $addToSet: { attention: anonId } });
    if (writer !== anonId) {
      await userCollection.updateOne({ anonId: writer }, { $inc: { point: 3 } }, { upsert: true });
    }
    const updatedLetter = await worryLetterCollection.findOne({ _id: new ObjectId(worryId) });
    res.status(200).json({ message: "공감 처리 성공", attentionList: updatedLetter.attention });
  }
});

// 포인트 조회
app.get("/points/:anonId", async (req, res) => {
  const { anonId } = req.params;
  try {
    const user = await userCollection.findOne({ anonId });
    const point = user ? user.point || 0 : 0;
    res.status(200).json({ point });
  } catch (error) {
    res.status(500).json({ error: "포인트 조회 실패" });
  }
});
// 레벨 조회
app.get("/levels/:anonId", async (req, res) => {
  const { anonId } = req.params;
  try {
    const user = await userCollection.findOne({ anonId });
    const level = user ? user.level || 0 : 0;
    res.status(200).json({ level });
  } catch (error) {
    res.status(500).json({ error: "레벨 조회 실패" });
  }
});

// 레벨 업
app.get("/levelUp/:anonId", async (req, res) => {
  const { anonId } = req.params;
  const user = await userCollection.findOne({ anonId });
  const currentLevel = user ? user.level || 0 : 0;
  const currentPoint = user ? user.point || 0 : 0;
  const pointsRequired = [0, 30, 70, 100, 150, 200, 300, 500, 700, 1000];

  if (currentLevel > 9) {
    return res.status(200).json({ message: "최고 레벨에 도달했습니다." });
  } else if (currentPoint < pointsRequired[currentLevel + 1]) {
    return res.status(400).json({ error: "레벨업에 필요한 포인트가 부족합니다." });
  } else {
    await userCollection.updateOne({ anonId }, { $inc: { level: 1 } });
    await userCollection.updateOne({ anonId }, { $inc: { point: -pointsRequired[currentLevel + 1] } });
    res.status(200).json({ message: "레벨업 성공" });
  }
});

async function startServer() {
  try {
    await client.connect();
    console.log("MongoDB 연결 성공");

    const db = client.db("greenpen"); // 예: "test"
    userCollection = db.collection("user"); // 예: "users"
    worryLetterCollection = db.collection("worryLetter"); // 예: "worryLetters"
    worryLetterCommentsCollection = db.collection("worryLetterComments"); // 예: "worryLetterComments"

    // 도배 방지를 위한 인덱스 생성 (한 번만 실행)
    await worryLetterCollection.createIndex({ anonId: 1, writtenDate: -1 });

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("MongoDB 연결 실패:", err);
  }
}

startServer();
