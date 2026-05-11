using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.FileProviders;
using MongoDB.Bson;
using MongoDB.Driver;

var builder = WebApplication.CreateBuilder(args);

var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? Array.Empty<string>();

var mongoSection = builder.Configuration.GetSection("Mongo");
var mongoConnectionString = mongoSection["ConnectionString"] ?? string.Empty;
var mongoDatabaseName = mongoSection["Database"] ?? "ttoys";

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length == 0 || allowedOrigins.Any(origin => origin == "*"))
        {
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
            return;
        }

        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

builder.Services.AddRouting(options => options.LowercaseUrls = true);

if (!string.IsNullOrWhiteSpace(mongoConnectionString))
{
    builder.Services.AddSingleton<IMongoClient>(_ => new MongoClient(mongoConnectionString));
    builder.Services.AddSingleton(sp =>
    {
        var client = sp.GetRequiredService<IMongoClient>();
        return client.GetDatabase(mongoDatabaseName);
    });
}

var app = builder.Build();

// When deployed behind a reverse proxy or hosted as HTTP-only, UseHttpsRedirection can break local/prod.
// Enable it only if the app knows its HTTPS port.
if (!string.IsNullOrWhiteSpace(builder.Configuration["ASPNETCORE_HTTPS_PORT"]))
{
    app.UseHttpsRedirection();
}
app.UseCors();

static string? FindFrontendPath(string startDirectory)
{
    var directory = new DirectoryInfo(startDirectory);
    for (var i = 0; i < 10 && directory != null; i++)
    {
        var candidate = Path.Combine(directory.FullName, "frontend");
        if (File.Exists(Path.Combine(candidate, "index.html")))
        {
            return candidate;
        }

        directory = directory.Parent;
    }

    return null;
}

var frontendPath = FindFrontendPath(builder.Environment.ContentRootPath);
if (!string.IsNullOrWhiteSpace(frontendPath) && Directory.Exists(frontendPath))
{
    var frontendProvider = new PhysicalFileProvider(frontendPath);
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = frontendProvider
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = frontendProvider
    });

    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = frontendProvider,
        RequestPath = "/frontend"
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = frontendProvider,
        RequestPath = "/frontend"
    });
}

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    time = DateTimeOffset.UtcNow
}));

app.MapGet("/api/info", (IHostEnvironment env) => Results.Ok(new
{
    name = "T-Toys API",
    environment = env.EnvironmentName
}));

app.MapPost("/app-logs/{appId}/log-user-in-app/{pageName}",
    (string appId, string pageName, HttpContext context) =>
    {
        context.Response.Headers.Append("Cache-Control", "no-store");
        return Results.NoContent();
    });

app.MapGet("/api/mongo/health", async (IServiceProvider services) =>
{
    var database = services.GetService<IMongoDatabase>();
    if (database == null)
    {
        return Results.Problem("Mongo is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    var command = new BsonDocument("ping", 1);
    await database.RunCommandAsync<BsonDocument>(command);
    return Results.Ok(new
    {
        status = "ok",
        database = database.DatabaseNamespace.DatabaseName
    });
});

if (!string.IsNullOrWhiteSpace(frontendPath) && Directory.Exists(frontendPath))
{
    var devIndexPath = Path.Combine(frontendPath, "dev", "index.html");

    app.MapGet("/dev", async context =>
    {
        if (!File.Exists(devIndexPath))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(devIndexPath);
    });

    app.MapGet("/dev/{*path}", async context =>
    {
        if (!File.Exists(devIndexPath))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(devIndexPath);
    });

    var frontendIndexPath = Path.Combine(frontendPath, "index.html");
    app.MapFallback(async context =>
    {
        if (Path.HasExtension(context.Request.Path))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        if (!File.Exists(frontendIndexPath))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(frontendIndexPath);
    });
}

app.Run();
