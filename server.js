const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const archiver = require("archiver");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = 3000;

const storageDir = path.resolve(__dirname, "storage");


/*
==================================================
CREATE STORAGE DIRECTORY
==================================================
*/

if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
}


/*
==================================================
SECURITY FUNCTIONS
==================================================
*/

// Safely convert a relative cloud path
// into an absolute path inside storage/
function safeStoragePath(relativePath = "") {

    if (typeof relativePath !== "string") {
        return null;
    }

    relativePath = relativePath.replace(/\\/g, "/");
    relativePath = relativePath.replace(/^\/+/, "");

    const fullPath = path.resolve(
        storageDir,
        relativePath
    );

    if (
        fullPath !== storageDir &&
        !fullPath.startsWith(
            storageDir + path.sep
        )
    ) {
        return null;
    }

    return fullPath;
}


// Clean one filename or folder name
function safeFilename(filename) {

    if (
        !filename ||
        typeof filename !== "string"
    ) {
        return "";
    }

    const baseName = path.basename(filename);

    const cleaned = baseName
        .replace(
            /[<>:"/\\|?*\x00-\x1F]/g,
            "_"
        )
        .trim();

    if (
        !cleaned ||
        cleaned === "." ||
        cleaned === ".."
    ) {
        return "";
    }

    return cleaned;
}


// Clean a relative folder path
function safeRelativePath(relativePath = "") {

    if (
        typeof relativePath !== "string"
    ) {
        return null;
    }

    relativePath =
        relativePath.replace(/\\/g, "/");

    relativePath =
        relativePath.replace(/^\/+/, "");

    if (relativePath === "") {
        return "";
    }

    const parts =
        relativePath.split("/");

    const cleanParts = [];

    for (const part of parts) {

        if (
            part === "" ||
            part === "."
        ) {
            continue;
        }

        if (part === "..") {
            return null;
        }

        const cleanPart =
            safeFilename(part);

        if (!cleanPart) {
            return null;
        }

        cleanParts.push(cleanPart);
    }

    return cleanParts.join("/");
}


// Get a safe directory
function getSafeDirectory(relativePath = "") {

    const cleanPath =
        safeRelativePath(relativePath);

    if (cleanPath === null) {
        return null;
    }

    return safeStoragePath(cleanPath);
}


/*
==================================================
MULTER STORAGE
==================================================
*/

const multerStorage =
    multer.diskStorage({

        destination: function (
            req,
            file,
            callback
        ) {

            const folder =
                req.query.folder || "";

            const folderPath =
                getSafeDirectory(folder);

            if (!folderPath) {

                return callback(
                    new Error(
                        "Invalid folder path"
                    )
                );
            }

            if (
                !fs.existsSync(
                    folderPath
                )
            ) {

                return callback(
                    new Error(
                        "Folder does not exist"
                    )
                );
            }

            if (
                !fs.statSync(
                    folderPath
                ).isDirectory()
            ) {

                return callback(
                    new Error(
                        "Upload location is not a folder"
                    )
                );
            }

            callback(
                null,
                folderPath
            );
        },


        filename: function (
            req,
            file,
            callback
        ) {

            const safeName =
                safeFilename(
                    file.originalname
                );

            if (!safeName) {

                return callback(
                    new Error(
                        "Invalid filename"
                    )
                );
            }

            const folder =
                req.query.folder || "";

            const folderPath =
                getSafeDirectory(folder);

            if (!folderPath) {

                return callback(
                    new Error(
                        "Invalid folder path"
                    )
                );
            }

            const finalPath =
                path.join(
                    folderPath,
                    safeName
                );

            // Do not overwrite existing files
            if (
                fs.existsSync(finalPath)
            ) {

                return callback(
                    new Error(
                        "A file or folder with this name already exists"
                    )
                );
            }

            callback(
                null,
                safeName
            );
        }
    });


const upload =
    multer({

        storage: multerStorage,

        limits: {
            fileSize:
                100 * 1024 * 1024
        }
    });


/*
==================================================
MIDDLEWARE
==================================================
*/

app.use(express.json());

app.use(
    cors({
        origin: true,
        credentials: true
    })
);



/*
==================================================
SESSION
==================================================
*/

app.use(
    session({
        secret:
            process.env.SESSION_SECRET,

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: false,
            maxAge:
                24 * 60 * 60 * 1000
        }
    })
);


/*
==================================================
AUTHENTICATION CONFIG
==================================================
*/

const CLOUD_USERNAME =
    process.env.CLOUD_USERNAME || "";

const CLOUD_PASSWORD =
    process.env.CLOUD_PASSWORD || "";


/*
    For this first version, the password from
    .env is converted into a bcrypt hash when
    the server starts.

    The actual password remains in .env and is
    not written into this source code.
*/

const CLOUD_PASSWORD_HASH =
    CLOUD_PASSWORD
        ? bcrypt.hashSync(
            CLOUD_PASSWORD,
            12
        )
        : "";


/*
==================================================
REQUIRE LOGIN
==================================================
*/

function requireLogin(
    req,
    res,
    next
) {

    if (
        req.session &&
        req.session.authenticated === true
    ) {
        return next();
    }

    return res.status(401).json({
        error:
            "Authentication required"
    });
}


/*
==================================================
LOGIN
==================================================
*/

app.post(
    "/api/login",
    async function (
        req,
        res
    ) {

        try {

            const username =
                typeof req.body.username === "string"
                    ? req.body.username.trim()
                    : "";

            const password =
                typeof req.body.password === "string"
                    ? req.body.password
                    : "";


            if (
                !username ||
                !password
            ) {

                return res.status(400).json({
                    error:
                        "Username and password are required"
                });
            }


            const usernameCorrect =
                username === CLOUD_USERNAME;


            const passwordCorrect =
                CLOUD_PASSWORD_HASH
                    ? await bcrypt.compare(
                        password,
                        CLOUD_PASSWORD_HASH
                    )
                    : false;


            if (
                !usernameCorrect ||
                !passwordCorrect
            ) {

                return res.status(401).json({
                    error:
                        "Invalid username or password"
                });
            }


            req.session.authenticated =
                true;

            req.session.username =
                username;


            return res.json({

                message:
                    "Login successful",

                username:
                    username

            });

        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            return res.status(500).json({
                error:
                    "Unable to login"
            });
        }
    }
);


/*
==================================================
CURRENT USER
==================================================
*/

app.get(
    "/api/me",
    function (
        req,
        res
    ) {

        if (
            !req.session ||
            req.session.authenticated !== true
        ) {

            return res.status(401).json({

                authenticated:
                    false,

                error:
                    "Not logged in"

            });
        }


        return res.json({

            authenticated:
                true,

            username:
                req.session.username

        });
    }
);


/*
==================================================
LOGOUT
==================================================
*/

app.post(
    "/api/logout",
    function (
        req,
        res
    ) {

        req.session.destroy(
            function (error) {

                if (error) {

                    console.error(
                        "Logout error:",
                        error
                    );

                    return res.status(500).json({
                        error:
                            "Unable to logout"
                    });
                }


                res.clearCookie(
                    "connect.sid"
                );


                return res.json({
                    message:
                        "Logged out successfully"
                });
            }
        );
    }
);


/*
==================================================
PROTECT API ROUTES
==================================================
*/

app.use(
    "/api",
    function (
        req,
        res,
        next
    ) {

        // Login must be public
        if (
            req.path === "/login" &&
            req.method === "POST"
        ) {
            return next();
        }


        // /api/me must be public so it
        // can report authentication status
        if (
            req.path === "/me" &&
            req.method === "GET"
        ) {
            return next();
        }


        // Logout must be accessible to
        // an authenticated user
        if (
            req.path === "/logout" &&
            req.method === "POST"
        ) {
            return next();
        }


        // Health check remains public
        if (
            req.path === "/health" &&
            req.method === "GET"
        ) {
            return next();
        }


        return requireLogin(
            req,
            res,
            next
        );
    }
);


/*
==================================================
ROOT PAGE
==================================================
*/

app.get(
    "/",
    function (
        req,
        res
    ) {

        if (
            req.session &&
            req.session.authenticated === true
        ) {

            return res.sendFile(
                path.join(
                    __dirname,
                    "public",
                    "index.html"
                )
            );
        }


        return res.redirect(
            "/login.html"
        );
    }
);


/*
==================================================
LOGIN PAGE
==================================================
*/

app.get(
    "/login.html",
    function (
        req,
        res
    ) {

        return res.sendFile(
            path.join(
                __dirname,
                "public",
                "login.html"
            )
        );
    }
);


/*
==================================================
PROTECT STATIC CLOUD FILES
==================================================
*/

app.use(
    function (
        req,
        res,
        next
    ) {

        if (
            req.path === "/login.html"
        ) {
            return next();
        }


        if (
            req.session &&
            req.session.authenticated === true
        ) {
            return next();
        }


        return res.redirect(
            "/login.html"
        );
    }
);


app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


/*
==================================================
HEALTH
==================================================
*/

app.get(
    "/api/health",

    function (
        req,
        res
    ) {

        res.json({
            status: "ok"
        });

    }
);


/*
==================================================
LIST FILES AND FOLDERS
==================================================
*/

app.get(
    "/api/files",
    function (
        req,
        res
    ) {

        try {

            const folder =
                req.query.folder || "";

            const search =
                (
                    req.query.search || ""
                ).toLowerCase();


            const folderPath =
                getSafeDirectory(folder);


            if (!folderPath) {

                return res.status(400).json({
                    error:
                        "Invalid folder path"
                });
            }

                        if (
                !fs.existsSync(
                    folderPath
                )
            ) {

                return res.status(404).json({
                    error:
                        "Folder not found"
                });
            }


            if (
                !fs.statSync(
                    folderPath
                ).isDirectory()
            ) {

                return res.status(400).json({
                    error:
                        "Not a folder"
                });
            }


            const names =
                fs.readdirSync(
                    folderPath
                );


            const items = [];


            for (
                const name of names
            ) {

                if (
                    search &&
                    !name
                        .toLowerCase()
                        .includes(search)
                ) {
                    continue;
                }


                const fullPath =
                    path.join(
                        folderPath,
                        name
                    );


                const stats =
                    fs.statSync(
                        fullPath
                    );


                items.push({

                    name:
                        name,

                    type:
                        stats.isDirectory()
                            ? "folder"
                            : "file",

                    size:
                        stats.isDirectory()
                            ? 0
                            : stats.size

                });
            }


            // Folders first
            items.sort(
                function (
                    a,
                    b
                ) {

                    if (
                        a.type !== b.type
                    ) {

                        return (
                            a.type === "folder"
                                ? -1
                                : 1
                        );
                    }


                    return a.name.localeCompare(
                        b.name,
                        undefined,
                        {
                            numeric: true,
                            sensitivity: "base"
                        }
                    );
                }
            );


            res.json({

                currentFolder:
                    folder,

                items:
                    items

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "Unable to list files"
            });
        }

    }
);


/*
==================================================
CREATE FOLDER
==================================================
*/

app.post(
    "/api/folders",
    function (
        req,
        res
    ) {

        try {

            const parentFolder =
                req.query.folder || "";

            const folderName =
                safeFilename(
                    req.query.name
                );


            if (!folderName) {

                return res.status(400).json({
                    error:
                        "Invalid folder name"
                });
            }


            const parentPath =
                getSafeDirectory(
                    parentFolder
                );


            if (!parentPath) {

                return res.status(400).json({
                    error:
                        "Invalid parent folder"
                });
            }


            if (
                !fs.existsSync(
                    parentPath
                )
            ) {

                return res.status(404).json({
                    error:
                        "Parent folder not found"
                });
            }


            const newFolderPath =
                path.join(
                    parentPath,
                    folderName
                );


            if (
                !newFolderPath.startsWith(
                    parentPath + path.sep
                )
            ) {

                return res.status(400).json({
                    error:
                        "Invalid folder path"
                });
            }


            if (
                fs.existsSync(
                    newFolderPath
                )
            ) {

                return res.status(409).json({
                    error:
                        "A file or folder with this name already exists"
                });
            }


            fs.mkdirSync(
                newFolderPath
            );


            res.json({

                message:
                    "Folder created successfully",

                name:
                    folderName

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "Unable to create folder"
            });
        }

    }
);


/*
==================================================
DOWNLOAD FILE
==================================================
*/

app.get(
    "/api/download",
    function (
        req,
        res
    ) {

        try {

            const file =
                req.query.file || "";


            const filePath =
                safeStoragePath(file);


            if (!filePath) {

                return res.status(400).json({
                    error:
                        "Invalid file path"
                });
            }


            if (
                !fs.existsSync(
                    filePath
                )
            ) {

                return res.status(404).json({
                    error:
                        "File not found"
                });
            }


            if (
                !fs.statSync(
                    filePath
                ).isFile()
            ) {

                return res.status(400).json({
                    error:
                        "This is a folder. Use Download ZIP instead."
                });
            }


            res.download(
                filePath
            );

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "Unable to download file"
            });
        }

    }
);


/*
==================================================
DOWNLOAD FOLDER AS ZIP
==================================================
*/

app.get(
    "/api/download-folder",
    function (
        req,
        res
    ) {

        try {

            const folder =
                req.query.folder || "";


            if (!folder) {

                return res.status(400).json({
                    error:
                        "Cannot download storage root"
                });
            }


            const folderPath =
                getSafeDirectory(
                    folder
                );


            if (!folderPath) {

                return res.status(400).json({
                    error:
                        "Invalid folder path"
                });
            }


            if (
                !fs.existsSync(
                    folderPath
                )
            ) {

                return res.status(404).json({
                    error:
                        "Folder not found"
                });
            }


            if (
                !fs.statSync(
                    folderPath
                ).isDirectory()
            ) {

                return res.status(400).json({
                    error:
                        "Not a folder"
                });
            }


            const folderName =
                path.basename(
                    folderPath
                );


            res.setHeader(
                "Content-Type",
                "application/zip"
            );


            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${folderName}.zip"`
            );


            const archive =
                archiver(
                    "zip",
                    {
                        zlib: {
                            level: 6
                        }
                    }
                );


            archive.on(
                "error",
                function (
                    error
                ) {

                    console.error(error);

                    if (
                        !res.headersSent
                    ) {

                        res.status(500).json({
                            error:
                                "Unable to create ZIP"
                        });

                    } else {

                        res.end();

                    }
                }
            );


            archive.pipe(res);


            archive.directory(
                folderPath,
                folderName
            );


            archive.finalize();

        } catch (error) {

            console.error(error);

            if (
                !res.headersSent
            ) {

                res.status(500).json({
                    error:
                        "Unable to download folder"
                });
            }
        }

    }
);


/*
==================================================
DELETE FILE OR FOLDER
==================================================
*/

app.delete(
    "/api/files",
    function (
        req,
        res
    ) {

        try {

            const target =
                req.query.path || "";


            const targetPath =
                safeStoragePath(
                    target
                );


            if (!targetPath) {

                return res.status(400).json({
                    error:
                        "Invalid path"
                });
            }


            if (
                targetPath === storageDir
            ) {

                return res.status(400).json({
                    error:
                        "Cannot delete storage root"
                });
            }


            if (
                !fs.existsSync(
                    targetPath
                )
            ) {

                return res.status(404).json({
                    error:
                        "File or folder not found"
                });
            }


            const stats =
                fs.statSync(
                    targetPath
                );


            // Delete file or entire folder
            fs.rmSync(
                targetPath,
                {
                    recursive:
                        stats.isDirectory(),

                    force:
                        true
                }
            );


            res.json({

                message:
                    stats.isDirectory()
                        ? "Folder deleted successfully"
                        : "File deleted successfully"

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "Unable to delete"
            });
        }

    }
);


/*
==================================================
RENAME
==================================================
*/

app.put(
    "/api/files",
    function (
        req,
        res
    ) {

        try {

            const oldPath =
                req.query.path || "";


            const newName =
                safeFilename(
                    req.query.newName
                );


            if (!newName) {

                return res.status(400).json({
                    error:
                        "Invalid new name"
                });
            }


            const oldFullPath =
                safeStoragePath(
                    oldPath
                );


            if (!oldFullPath) {

                return res.status(400).json({
                    error:
                        "Invalid old path"
                });
            }


            if (
                oldFullPath === storageDir
            ) {

                return res.status(400).json({
                    error:
                        "Cannot rename storage root"
                });
            }


            if (
                !fs.existsSync(
                    oldFullPath
                )
            ) {

                return res.status(404).json({
                    error:
                        "File or folder not found"
                });
            }


            const parentDir =
                path.dirname(
                    oldFullPath
                );


            const newFullPath =
                path.join(
                    parentDir,
                    newName
                );


            if (
                !newFullPath.startsWith(
                    parentDir + path.sep
                )
            ) {

                return res.status(400).json({
                    error:
                        "Invalid new path"
                });
            }


            if (
                fs.existsSync(
                    newFullPath
                )
            ) {

                return res.status(409).json({
                    error:
                        "A file or folder with this name already exists"
                });
            }


            fs.renameSync(
                oldFullPath,
                newFullPath
            );


            res.json({

                message:
                    "Renamed successfully",

                oldName:
                    path.basename(
                        oldFullPath
                    ),

                newName:
                    newName

            });

        } catch (error) {

            console.error(error);

            res.status(500).json({
                error:
                    "Unable to rename"
            });
        }

    }
);


/*
==================================================
UPLOAD
==================================================
*/

app.post(
    "/api/upload",
    function (
        req,
        res
    ) {

        upload.single("file")(
            req,
            res,
            function (
                error
            ) {

                if (error) {

                    console.error(error);

                    if (
                        error.code ===
                        "LIMIT_FILE_SIZE"
                    ) {

                        return res.status(413).json({
                            error:
                                "File is too large. Maximum size is 100 MB."
                        });
                    }


                    return res.status(400).json({
                        error:
                            error.message ||
                            "Upload failed"
                    });
                }


                if (!req.file) {

                    return res.status(400).json({
                        error:
                            "No file was uploaded"
                    });
                }


                res.json({

                    message:
                        "File uploaded successfully",

                    file: {

                        name:
                            req.file.filename,

                        size:
                            req.file.size,

                        folder:
                            req.query.folder || ""

                    }

                });

            }
        );

    }
);


/*
==================================================
START SERVER
==================================================
*/

app.listen(
    PORT,
    function () {

        console.log(
            `Personal Cloud running at http://localhost:${PORT}`
        );

    }
);