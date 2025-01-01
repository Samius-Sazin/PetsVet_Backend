require('dotenv').config();

const express = require('express');
const app = express();
const port = process.env.PORT || 9000;

const cors = require('cors');
app.use(cors());
app.use(express.json());


// **** ___ multer setup start ___****
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer Storage with Dynamic Directories
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const imageCategory = req.query.type; // 'products', 'articles', 'q&a'
        const uploadDirectory = path.join('uploads', imageCategory);

        try {
            // Ensure the directory exists, Create uploads directory if it doesn't exist
            if (!fs.existsSync(uploadDirectory)) {
                fs.mkdirSync(uploadDirectory, { recursive: true });
            }

            cb(null, uploadDirectory);
        }
        catch (err) {
            console.log("ERROR: ", err);
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        // Extract original file name without extension, Replace spaces with hyphens for safety, Convert to lowercase for consistency
        const originalName = path.basename(file.originalname, path.extname(file.originalname)).replace(/\s+/g, '-').toLowerCase();

        // Create new file name with timestamp
        const newFilename = `${Date.now()}-${originalName}${path.extname(file.originalname)}`;

        cb(null, newFilename);
    },
});

// Multer Filter to Allow Only Images
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg',];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error('Invalid file type. Only JPEG, PNG are allowed.'));
    }
};

// Initialize Multer
const upload = multer(
    {
        storage: storage,
        fileFilter: fileFilter,
        limits: { fileSize: 40 * 1024 * 1024 }, // Limit file size to 40MB
    }
);

// Serve static files from the uploads directory
const baseUploadDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(baseUploadDir));

// **** ___ multer setup end ___****


// mongodb setup
const { MongoClient, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ftnnv.mongodb.net/`;
const client = new MongoClient(uri);

async function run() {
    try {
        const database = client.db(process.env.DB_USER);
        const usersCollection = database.collection("users");
        const servicesCollection = database.collection("services");
        const productsCollection = database.collection("products");
        const articlesCollection = database.collection("articles");
        const qnaCollection = database.collection("qna");


        // Endpoint for Single Image Upload (Multer + DB) (article, products, qna)
        try {
            app.post('/upload-single', upload.single('image'), async (req, res) => {
                const uploadType = "products";

                if (!req.file) {
                    return res.status(400).send(`No file uploaded for ${uploadType}.`);
                }

                // Generate URL for uploaded image
                const imageName = req.file.filename;
                const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${uploadType}/${imageName}`;

                const data = req.body;
                data.images = [imageUrl];

                // upload to db
                let result = null;
                try {
                    if (uploadType === 'products') {
                        result = await productsCollection.insertOne(data);
                    }
                    else if (uploadType === 'articles') {
                        result = await articlesCollection.insertOne(data);
                    }
                    else if (uploadType === 'qna') {
                        result = await qnaCollection.insertOne(data);
                    }
                }
                catch (error) {
                    res.status(500).send('Error in uploading product to Database ');
                }

                // successfully uploaded
                res.send(result);
            });
        }
        catch (error) {
            res.status(500).send('Multer Error');
        }

        // Endpoint for Multiple Image Upload (Multer + DB) (article, products, qna)
        try {
            app.post('/upload-multiple', upload.array('images', 10), async (req, res) => {
                const uploadType = req.query.type;

                if (!req.files || req.files.length === 0) {
                    return res.status(400).send(`No files uploaded for ${uploadType}.`);
                }
                // Generate URLs for uploaded images
                const images = req.files;
                const imageUrls = images.map((image) => {
                    const imageName = image.filename;
                    const fullUrl = `${req.protocol}://${req.get('host')}/uploads/${uploadType}/${imageName}`;
                    return fullUrl;
                });

                const data = req.body;
                data.images = imageUrls;

                // upload to db
                let result = null;
                try {
                    if (uploadType === 'products') {
                        result = await productsCollection.insertOne(data);
                    }
                    else if (uploadType === 'articles') {
                        result = await articlesCollection.insertOne(data);
                    }
                    else if (uploadType === 'qna') {
                        result = await qnaCollection.insertOne(data);
                    }
                }
                catch (error) {
                    res.status(500).send('Error in uploading product to Database ');
                }

                // successfully uploaded
                res.send(result);
            });
        }
        catch (error) {
            console.error('Error uploading files:', error);
            res.status(500).send('An error occurred while uploading files.');
        }

        // delete a product/article/qna from (DB + Multer) with it's id
        app.post('/delete-item', async (req, res) => {
            const data = req.body.data; // data is an object that contains _id, type & images

            const type = data.type;     // 'products', 'articles', 'qna'
            const id = data.productId;  // id of the product or article or qna
            const images = data.images; // array of image URLs, that need to be removed from storage(Multer)

            // delete from storage(Multer)
            if (images.length <= 0) {
                return res.status(400).json({ error: 'Image file is empty' });
            }

            try {
                // Step 1: Delete Images from Storage (Multer)
                for (const image of images) {
                    const filePath = path.join(__dirname, `uploads/${type}`, image);

                    try {
                        // Check if file exists
                        await fs.promises.access(filePath, fs.constants.F_OK);

                        // Delete the file
                        await fs.promises.unlink(filePath);
                    }
                    catch (err) {
                        // console.error(`Error deleting file ${filePath}:`, err.message);
                        return res.status(500).json({ error: `Multer: Error deleting file: ${image}` });
                    }
                }

                // Step 2: Delete from MongoDB
                const query = { _id: new ObjectId(id) };
                let result = null;

                if (type === 'products') {
                    result = await productsCollection.deleteOne(query);
                }
                else if (type === 'articles') {
                    result = await articlesCollection.deleteOne(query);
                }
                else if (type === 'qna') {
                    result = await qnaCollection.deleteOne(query);
                }

                if (!result || result.deletedCount === 0) {
                    return res.status(404).json({ error: 'MongoDB: No item found with the provided ID' });
                }

                // Success response
                res.send(result);
            }
            catch (error) {
                res.status(500).json({ error: 'Internal server error' });
            }
        })

        // get all products from DB
        app.get('/get-products', async (req, res) => {
            const cursor = productsCollection.find({});
            const products = await cursor.toArray();
            res.send(products);
        })

    }
    finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.listen(port, () => {
    console.log("PORT : ", port);
})